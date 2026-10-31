/**
 * The family book's composable blocks (1031 §5, §6.4): each one takes its
 * subject and the book's context and returns HTML, without a DOM. The same
 * blocks will make the lineage and family pages later (P4); `ctx.mode` says
 * where they go and `ctx.linkTo` how a reference becomes a link.
 *
 * Every name, date and place comes from the protected tree (`ctx.tree`):
 * the living are shown as the chosen privacy mode shows them, and a living
 * person's lineage is not mentioned under initials or hidden names (§3.4).
 */

import { Partnership, Person, PersonId, Source, StromData, Story, personSourceIds } from './types.js';
import { PrivacyMode } from './privacy.js';
import { getStringsForLang } from './strings.js';
import { formatFlexDate, yearOf } from './dates.js';
import { sortCoupleEvents } from './events.js';
import { shownNameOrEmpty } from './person-name.js';
import { feminineForm, czechRulesApply } from './surnames.js';
import { safeHttpUrl } from './validation.js';
import { proseHtml, coupleStoryYears } from './story-text.js';
import { marriedInto, Rod, RodId, rodPlaceSpans, sortByBirth } from './lineage.js';
import {
    PERSON_PAGE_ALL_GROUPS, PersonPageContext, PersonPageOptions, ProtectedPersonPageTree,
    cleanWorkNote, personBookChartHtml, personBookClipsHtml, personBookResearchHtml, personBookTimelineHtml, personPageDate,
    preparePersonPageData, stripResearchIds,
} from './person-page.js';
import { BookChapter, BookModel } from './book-model.js';
import { BookDetail, BookLang, BookParts } from './book-options.js';

export type BookMode = 'book' | 'app' | 'file';
export type BookLinkTarget = { chapter: number } | { rod: number } | { person: PersonId };

/** The width of the type area in CSS px (166 mm). */
export const BOOK_TEXT_WIDTH = 627;

/** P1…Pn by first occurrence in the book (§5.7), with the chapters that cite each source. */
export class BookSourceNumbers {
    readonly no = new Map<string, number>();
    readonly chapters = new Map<string, number[]>();
    /** The chapter being written (0 outside chapters). */
    chapter = 0;
    private readonly inChapter = new Map<number, string[]>();

    constructor(private readonly catalog: Readonly<Record<string, Source>>, private readonly on: boolean) {}

    /** The marker of a source ('' for an unknown source or with the Sources part off). */
    cite(id: string): string {
        if (!this.on || !this.catalog[id]) return '';
        let n = this.no.get(id);
        if (n === undefined) { n = this.no.size + 1; this.no.set(id, n); }
        if (this.chapter) {
            const back = this.chapters.get(id) ?? [];
            if (!back.includes(this.chapter)) { back.push(this.chapter); this.chapters.set(id, back); }
            const here = this.inChapter.get(this.chapter) ?? [];
            if (!here.includes(id)) { here.push(id); this.inChapter.set(this.chapter, here); }
        }
        return `<sup class="book-p">P${n}</sup>`;
    }

    citeAll(ids: readonly string[] | undefined): string {
        return [...new Set(ids ?? [])].map(id => this.cite(id)).join('');
    }

    /** The sources a chapter cited, in the order of their numbers. */
    ofChapter(chapter: number): string[] {
        return [...(this.inChapter.get(chapter) ?? [])].sort((a, b) => (this.no.get(a) ?? 0) - (this.no.get(b) ?? 0));
    }

    source(id: string): Source | undefined {
        return this.catalog[id];
    }
}

/** What the screen adds to a story (the new version's banner, the approve link); never printed. */
export interface BookStoryExtras {
    banner?: (story: Story, owner: { person: Person } | { couple: Partnership }) => string;
    approve?: (person: Person) => string;
}

export interface BookCtx {
    mode: BookMode;
    lang: BookLang;
    privacy: PrivacyMode;
    detail: BookDetail;
    parts: BookParts;
    notes: boolean;
    research: boolean;
    linkTo: (target: BookLinkTarget, ctx: BookCtx) => string | null;
    /** The tree after privacy (and without media when the part is off). */
    tree: StromData;
    /** Living people, judged before protection. */
    living: ReadonlySet<PersonId>;
    model: BookModel;
    sources: BookSourceNumbers;
    now: Date;
    /** A person's history layer (the research's), as the person page gets it. */
    personHistory?: (personId: PersonId) => PersonPageContext['history'];
    extras?: BookStoryExtras;
    /** People described in full so far: person → the chapter. */
    described: Map<PersonId, number>;
    /** The protected tree as the person page's helpers take it. */
    protectedTree: ProtectedPersonPageTree;
}

type Strings = ReturnType<typeof getStringsForLang>;

function esc(text: string): string {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const stringsCache = new Map<BookLang, Strings>();
function T(ctx: BookCtx): Strings {
    let s = stringsCache.get(ctx.lang);
    if (!s) { s = getStringsForLang(ctx.lang); stringsCache.set(ctx.lang, s); }
    return s;
}

export function roman(n: number): string {
    const map: [number, string][] = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
    let out = '';
    let v = Math.max(1, Math.floor(n));
    for (const [k, s] of map) while (v >= k) { out += s; v -= k; }
    return out;
}

function gKey(p: Person | undefined): 'm' | 'f' | 'u' {
    return p?.gender === 'male' ? 'm' : p?.gender === 'female' ? 'f' : 'u';
}

function person(ctx: BookCtx, id: PersonId | undefined | null): Person | undefined {
    return id ? ctx.tree.persons[id] : undefined;
}

/** The shown name, escaped ('?' for a missing one). */
export function bookName(ctx: BookCtx, id: PersonId | undefined | null): string {
    const p = person(ctx, id);
    return esc(p && !p.isPlaceholder ? shownNameOrEmpty(p) || '?' : '?');
}

/** "1824–1890", "* 1952", "† 1890" or ''. */
export function bookYears(p: Person | undefined): string {
    if (!p) return '';
    const b = yearOf(p.birthDate), d = yearOf(p.deathDate);
    if (b !== null && d !== null) return `${b}–${d}`;
    if (b !== null) return `* ${b}`;
    if (d !== null) return `† ${d}`;
    return '';
}

/** A living person under a privacy other than full: no details. */
function shielded(ctx: BookCtx, id: PersonId): boolean {
    return ctx.living.has(id) && ctx.privacy !== 'full';
}

/** May the person's lineage be named (§3.4: not for the living under initials or hidden names)? */
function rodShown(ctx: BookCtx, id: PersonId): boolean {
    return !(ctx.living.has(id) && (ctx.privacy === 'initials' || ctx.privacy === 'anonymous'));
}

function link(ctx: BookCtx, target: BookLinkTarget, html: string): string {
    const href = ctx.linkTo(target, ctx);
    return href ? `<a href="${esc(href)}">${html}</a>` : html;
}

function chapterRef(ctx: BookCtx, n: number, arrow = false): string {
    return link(ctx, { chapter: n }, `${arrow ? '→ ' : ''}${esc(T(ctx).book.chapterRef(n))}`);
}

/** The label of a lineage, protected when its founder is a living person under initials / hidden names. */
export function rodLabelOf(ctx: BookCtx, rodId: RodId | null | undefined): string {
    if (!rodId) return '';
    const rod = ctx.model.index.rods.get(rodId);
    const label = ctx.model.labels.get(rodId) ?? rod?.surname ?? '';
    if (rod && !rodShown(ctx, rod.founderId)) return person(ctx, rod.founderId)?.lastName || '?';
    return label;
}

function rodOfPerson(ctx: BookCtx, id: PersonId): RodId | null {
    return ctx.model.index.rodByPerson.get(id) ?? null;
}

/**
 * A spouse's birth lineage when it is worth naming beside the marriage: not
 * a one-person lineage (a wife who married in without recorded parents is
 * not a family of her own; the person card's row says the same).
 */
function birthRodNamed(ctx: BookCtx, id: PersonId): RodId | null {
    const rodId = rodOfPerson(ctx, id);
    const rod = rodId ? ctx.model.index.rods.get(rodId) : undefined;
    return rod && !rod.solitary ? rod.id : null;
}

function marriageText(ctx: BookCtx, u: Partnership): string {
    const B = T(ctx).book;
    const start = [u.startDate ? formatFlexDate(u.startDate, ctx.lang) : '', u.startPlace ?? ''].filter(Boolean).join(', ');
    let line = u.status === 'partners' ? [B.partners, start].filter(Boolean).join(' ') : (start ? `⚭ ${start}` : '');
    const endDate = u.endDate ? formatFlexDate(u.endDate, ctx.lang) : '';
    let endLabel = '';
    if (u.status === 'divorced' || (u.status === 'married' && u.endDate)) endLabel = B.divorced;
    else if (u.status === 'separated') endLabel = B.separated;
    else if (u.status === 'partners' && u.endDate) endLabel = B.ended;
    if (endLabel) {
        const end = [endLabel, endDate].filter(Boolean).join(' ');
        line = line ? `${line} · ${end}` : `⚭ · ${end}`;
    }
    return esc(line);
}

/** The couple's partners in the order of the heading: husband first, else as recorded. */
function couple(ctx: BookCtx, u: Partnership): PersonId[] {
    const ids = [u.person1Id, u.person2Id].filter(id => !!id && !!ctx.tree.persons[id] && !ctx.tree.persons[id].isPlaceholder);
    return ids.sort((a, b) => (ctx.tree.persons[a].gender === 'female' ? 1 : 0) - (ctx.tree.persons[b].gender === 'female' ? 1 : 0));
}

/** "{first name} and {first name}" from the protected tree, escaped (the book window's side contents). */
export function pairFirstNames(ctx: BookCtx, u: Partnership): string {
    const ids = couple(ctx, u);
    const first = (id: PersonId): string => {
        const p = ctx.tree.persons[id];
        return esc(p?.firstName?.trim() || p?.lastName?.trim() || '?');
    };
    return ids.length ? ids.map(first).join(` ${esc(T(ctx).book.and)} `) : '?';
}

/** "{husband} and {wife}" from the protected tree, escaped. */
export function pairName(ctx: BookCtx, u: Partnership): string {
    const ids = couple(ctx, u);
    const and = esc(T(ctx).book.and);
    return ids.length ? ids.map(id => bookName(ctx, id)).join(` ${and} `) : '?';
}

// ─── A lineage (§5.3) ───────────────────────────────────────────────────────

/** The places the line lived in: rows on a common time axis (max 6 + "and N more"). */
function placesHtml(ctx: BookCtx, rod: Rod): string {
    const B = T(ctx).book;
    const spans = rodPlaceSpans(ctx.model.index, rod.id, id => shielded(ctx, id));
    if (!spans.length) return '';
    const shown = spans.slice(0, 6);
    const lo = Math.min(...shown.map(s => s.from));
    const hi = Math.max(...shown.map(s => s.to));
    const w = Math.max(1, hi - lo);
    const rows = shown.map(s => {
        const left = ((s.from - lo) / w) * 100;
        const width = Math.max(1.5, ((s.to - s.from) / w) * 100);
        return `<div class="book-place"><span>${esc(s.name)}</span><span class="book-place-axis"><span class="book-place-bar" style="left:${left.toFixed(1)}%;width:${Math.min(100 - left, width).toFixed(1)}%" title="${s.from}–${s.to}"></span></span>`
            + `<span class="book-place-n">${esc(B.placePersons(s.persons))}</span></div>`;
    }).join('');
    const more = spans.length > 6 ? `<p class="book-muted">${esc(B.morePlaces(spans.length - 6))}</p>` : '';
    return `<div class="book-places"><h3 class="book-sub">${esc(B.wherePlaces)}</h3>${rows}<div class="book-place-years"><span>${lo}</span><span>${hi}</span></div>${more}</div>`;
}

/** The male line as cards by generation, only when it fits the page (max 4 generations of at most 5 cards). */
function maleLineHtml(ctx: BookCtx, rod: Rod): string {
    const B = T(ctx).book;
    const gens = new Map<number, PersonId[]>();
    for (const id of rod.memberIds) {
        const p = person(ctx, id);
        if (!p || p.isPlaceholder || p.gender !== 'male' || !rodShown(ctx, id)) continue;
        const g = ctx.model.rodGeneration(id);
        gens.set(g, [...(gens.get(g) ?? []), id]);
    }
    const levels = [...gens.keys()].sort((a, b) => a - b);
    if (levels.length < 2 || levels.length > 4 || levels.some(g => (gens.get(g)?.length ?? 0) > 5)) return '';
    const rows = levels.map(g => `<div class="book-maleline-gen">${gens.get(g)!.map(id =>
        `<span class="book-maleline-card">${bookName(ctx, id)}<br><span class="book-muted">${esc(bookYears(person(ctx, id)))}</span></span>`).join('')}</div>`).join('');
    return `<div class="book-maleline"><h3 class="book-sub">${esc(B.maleLine)}</h3>${rows}</div>`;
}

/** The lineage's opening page: name, facts, places, and the male line when it fits. */
export function rodOverviewHtml(rod: Rod, ctx: BookCtx): string {
    const S = T(ctx);
    const B = S.book;
    const label = rodLabelOf(ctx, rod.id);
    const founder = person(ctx, rod.founderId);
    const rows: [string, string][] = [];
    if (founder) {
        const bits: string[] = [];
        if (!shielded(ctx, rod.founderId)) {
            const b = yearOf(founder.birthDate), d = yearOf(founder.deathDate);
            if (b !== null || founder.birthPlace) bits.push(`* ${[b, founder.birthPlace].filter(x => x != null && x !== '').join(' ')}`);
            if (d !== null || founder.deathPlace) bits.push(`† ${[d, founder.deathPlace].filter(x => x != null && x !== '').join(' ')}`);
        }
        rows.push([B.founder[gKey(founder)], `${bookName(ctx, rod.founderId)}${bits.length ? ` (${esc(bits.join(', '))})` : ''}`]);
    }
    if (rod.period) rows.push([B.period, esc(B.periodValue(rod.period.from, rod.period.to))]);
    if (rodShown(ctx, rod.founderId)) {
        const forms = rod.forms.length ? rod.forms : [rod.surname];
        let text = esc(forms.join(', '));
        if (czechRulesApply(ctx.model.index.data)) {
            const fem = [...new Set(forms.map(f => feminineForm(f)).filter((f): f is string => !!f))];
            if (fem.length) text += `; ${esc(B.femaleForms(fem.join(', ')))}`;
        }
        rows.push([B.nameForms, text]);
    }
    rows.push([B.inRod, esc(B.inRodValue(rod.realMemberCount, rod.realSpouseCount, rod.generations, rod.familyIds.length))]);
    const linked = new Set<RodId>();
    for (const s of rod.spouses) if (s.birthRodId && s.birthRodId !== rod.id && rodShown(ctx, s.personId)) linked.add(s.birthRodId);
    for (const id of rod.memberIds) {
        if (!rodShown(ctx, id)) continue;
        for (const m of marriedInto(ctx.model.index, id)) if (m.rodId !== rod.id) linked.add(m.rodId);
    }
    if (linked.size) {
        rows.push([B.linkedRods, [...linked].map(r => esc(rodLabelOf(ctx, r))).sort((a, b) => a.localeCompare(b, ctx.lang)).join(', ')]);
    }
    return `<header class="book-rod-head"><div class="book-kicker">${esc(B.rodKicker)}</div><h1 class="book-rod-name">${esc(label)}</h1><hr class="book-rule"></header>`
        + `<dl class="book-grid">${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v}</dd>`).join('')}</dl>`
        + placesHtml(ctx, rod)
        + maleLineHtml(ctx, rod);
}

/** Did the opening page draw the male line (the line tree then starts on the next page)? */
export function rodHasMaleLine(rod: Rod, ctx: BookCtx): boolean {
    return maleLineHtml(ctx, rod) !== '';
}

function diedYoung(p: Person): boolean {
    const b = yearOf(p.birthDate), d = yearOf(p.deathDate);
    return b !== null && d !== null && d - b < 15 && p.partnerships.length === 0;
}

/** The lineage's line tree, variant B (§5.3): one row per member, indented by generation. */
export function rodLineageHtml(rod: Rod, ctx: BookCtx, opts: { breakBefore?: boolean; id?: string } = {}): string {
    const B = T(ctx).book;
    const index = ctx.model.index;
    const rows: string[] = [];
    const row = (gen: number, text: string, ref = ''): string => {
        const lv = Math.max(0, gen - 1);
        return `<div class="book-lineage-row"><span class="book-lineage-gen">${roman(gen)}</span>`
            + `<span class="book-lineage-text" style="padding-left:${lv * 22}px;--lv:${lv}">${text}</span><span class="book-lineage-ref">${ref}</span></div>`;
    };
    const families = new Set(rod.familyIds);
    let young: { gen: number; parent: PersonId | null; items: string[] } | null = null;
    const flushYoung = (): void => {
        if (young) rows.push(row(young.gen, `<span class="book-young">${young.items.join(' · ')}</span>`));
        young = null;
    };
    for (const id of rod.memberIds) {
        const p = person(ctx, id);
        if (!p || p.isPlaceholder || !rodShown(ctx, id)) continue;
        const gen = ctx.model.rodGeneration(id);
        const name = bookName(ctx, id);
        const years = esc(bookYears(p));
        const own = p.partnerships.filter(uid => families.has(uid)).map(uid => ctx.tree.partnerships[uid]).filter((u): u is Partnership => !!u);
        if (!own.length && diedYoung(p)) {
            const parent = index.lineParent.get(id) ?? null;
            const item = `${esc(p.firstName?.trim() || shownNameOrEmpty(p) || '?')} ${years}`;
            if (young && young.parent === parent && young.gen === gen) young.items.push(item);
            else { flushYoung(); young = { gen, parent, items: [item] }; }
            continue;
        }
        flushYoung();
        if (own.length) {
            const marr = own.map(u => {
                const other = u.person1Id === id ? u.person2Id : u.person1Id;
                const op = person(ctx, other);
                const y = yearOf(u.startDate);
                const otherRod = other && rodShown(ctx, other) ? birthRodNamed(ctx, other) : null;
                const rodTxt = otherRod && otherRod !== rod.id ? ` ${esc(B.spouseRod(rodLabelOf(ctx, otherRod)))}` : '';
                return `<span class="book-marr">⚭ ${y !== null ? `${y} ` : ''}${op && !op.isPlaceholder ? bookName(ctx, other) : '?'}${rodTxt}</span>`;
            }).join('');
            const ch = ctx.model.chapterOf.get(own[0].id);
            rows.push(row(gen, `<span class="is-family">${name}${years ? ` ${years}` : ''}</span>${marr}`, ch ? chapterRef(ctx, ch.no) : ''));
            continue;
        }
        const out = marriedInto(index, id).filter(m => m.rodId !== rod.id);
        if (out.length) {
            const m = out[0];
            const ch = ctx.model.chapterOf.get(m.partnershipId);
            rows.push(row(gen, `<span class="is-out">${name}${years ? ` ${years}` : ''}, ${esc(B.marriedInto[gKey(p)](rodLabelOf(ctx, m.rodId)))}</span>`, ch ? chapterRef(ctx, ch.no) : ''));
            continue;
        }
        rows.push(row(gen, `${name}${years ? ` ${years}` : ''}`));
    }
    flushYoung();
    if (!rows.length) return '';
    return `<section class="book-rod-lineage${opts.breakBefore ? ' book-break' : ''}"${opts.id ? ` id="${esc(opts.id)}"` : ''}><h2>${esc(B.parts.tree)}</h2>${rows.join('')}</section>`;
}

// ─── A person (§5.5) ────────────────────────────────────────────────────────

const CONFLICT_FACTS: Record<'birth' | 'baptism' | 'death' | 'burial', string[]> = {
    birth: ['BIRT'], baptism: ['CHR', 'BAPM'], death: ['DEAT'], burial: ['BURI', 'CREM'],
};

/** The evidence mark after a fact (§5.8): ● documented / ◐ conflict: {value} in P{n} / ○ not documented. */
function evidenceMark(ctx: BookCtx, p: Person, fact: keyof typeof CONFLICT_FACTS, status: string | undefined, sourceIds: readonly string[] | undefined, shown: string): string {
    if (!ctx.research) return '';
    const B = T(ctx).book;
    const conflict = (p.research?.conflicts ?? []).find(k => k.status === 'open' && CONFLICT_FACTS[fact].includes(k.fact));
    if (conflict) {
        const other = conflict.values.find(v => stripResearchIds(v.value).text.trim() && !shown.includes(stripResearchIds(v.value).text.trim())) ?? conflict.values[0];
        const sid = (other?.sourceIds ?? []).find(id => !!ctx.sources.source(id));
        const marker = sid ? ctx.sources.cite(sid).replace(/<[^>]*>/g, '') : '';
        const value = other ? stripResearchIds(other.value).text.trim() : '';
        return `<span class="book-mark">◐ ${esc(B.evidence.conflict(value, marker || '?'))}</span>`;
    }
    const sourced = (sourceIds ?? []).some(id => !!ctx.sources.source(id));
    return status === 'proven' || sourced
        ? `<span class="book-mark">● ${esc(B.evidence.proven)}</span>`
        : `<span class="book-mark">○ ${esc(B.evidence.unproven)}</span>`;
}

function factsHtml(ctx: BookCtx, p: Person): string {
    const S = T(ctx);
    const P = S.personPage;
    const g = gKey(p);
    const rows: [string, string][] = [];
    const where = (date: string | undefined, place: string | undefined): string =>
        [personPageDate(date, ctx.lang), place?.trim() ?? ''].filter(Boolean).map(esc).join(', ');
    if (p.birthDate || p.birthPlace) {
        const shown = where(p.birthDate, p.birthPlace);
        rows.push([P.born[g], shown + ctx.sources.citeAll(p.birthSourceIds) + evidenceMark(ctx, p, 'birth', p.birthStatus, p.birthSourceIds, shown)]);
    }
    const events = p.events ?? [];
    const bapt = events.find(e => e.type === 'baptism' && (e.date || e.place));
    if (bapt && bapt.date !== p.birthDate) {
        const shown = where(bapt.date, bapt.place);
        rows.push([P.baptised[g], shown + ctx.sources.citeAll(bapt.sourceIds) + evidenceMark(ctx, p, 'baptism', bapt.status, bapt.sourceIds, shown)]);
    }
    if (p.deathDate || p.deathPlace) {
        const shown = where(p.deathDate, p.deathPlace);
        rows.push([P.died[g], shown + ctx.sources.citeAll(p.deathSourceIds) + evidenceMark(ctx, p, 'death', p.deathStatus, p.deathSourceIds, shown)]);
    }
    const burial = events.find(e => e.type === 'burial' && (e.date || e.place));
    if (burial) {
        const shown = where(burial.date, burial.place);
        rows.push([S.events.types.burial, shown + ctx.sources.citeAll(burial.sourceIds) + evidenceMark(ctx, p, 'burial', burial.status, burial.sourceIds, shown)]);
    }
    const jobs = events.filter(e => e.type === 'occupation').map(e => {
        const what = stripResearchIds(e.note?.trim() ?? '').text.trim();
        const y = yearOf(e.date);
        return what ? `${esc(what)}${y !== null ? ` (${y})` : ''}${ctx.sources.citeAll(e.sourceIds)}` : '';
    }).filter(Boolean);
    if (jobs.length) rows.push([P.occupation, jobs.join(', ')]);
    const homes = events.filter(e => e.type === 'residence' && e.place?.trim()).map(e => {
        const y = yearOf(e.date);
        return `${esc(e.place!.trim())}${y !== null ? ` (${y})` : ''}${ctx.sources.citeAll(e.sourceIds)}`;
    });
    if (homes.length) rows.push([S.events.types.residence, homes.join(', ')]);
    return rows.length ? `<dl class="book-grid">${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v}</dd>`).join('')}</dl>` : '';
}

function pageOptions(ctx: BookCtx, id: PersonId): PersonPageOptions {
    return {
        personId: id, lang: ctx.lang, mode: 'print', links: 'plain',
        groups: { ...PERSON_PAGE_ALL_GROUPS, history: ctx.parts.history, childEvents: false, excerpts: ctx.parts.media, materials: false, pdf: false, research: ctx.research },
        privacy: ctx.privacy, toggles: { history: ctx.parts.history, childEvents: false },
        research: ctx.parts.history || ctx.research, now: ctx.now, chartWidth: BOOK_TEXT_WIDTH,
    };
}

/** One person of a family, by the detail (§4.4); a person described before gets a reference to that chapter. */
export function personBookHtml(id: PersonId, ctx: BookCtx, opts: { chapter: number; fromRod?: { label: string; chapter?: number } } = { chapter: 0 }): string {
    const B = T(ctx).book;
    const p = person(ctx, id);
    if (!p || p.isPlaceholder) return '';
    const years = bookYears(p);
    const head = `${bookName(ctx, id)}${years ? ` <span class="book-years">${esc(years)}</span>` : ''}`;
    const before = ctx.described.get(id);
    if (before !== undefined && before !== opts.chapter) {
        return `<p class="book-person book-person-see"><strong>${head}</strong> · ${chapterRef(ctx, before, true)}</p>`;
    }
    ctx.described.set(id, opts.chapter);
    const from = opts.fromRod && rodShown(ctx, id)
        ? ` <span class="book-from">· ${esc(B.fromRod(opts.fromRod.label))}${opts.fromRod.chapter ? `, ${chapterRef(ctx, opts.fromRod.chapter)}` : ''}</span>` : '';
    const h3 = `<h3>${head}${shielded(ctx, id) ? '' : ctx.sources.citeAll(p.sourceIds)}${from}</h3>`;
    if (shielded(ctx, id)) return `<section class="book-person">${h3}</section>`;
    const parts: string[] = [h3];
    if (ctx.parts.media && p.photo && /^data:image\//.test(p.photo)) parts.unshift(`<img class="book-photo" src="${esc(p.photo)}" alt="">`);
    parts.push(factsHtml(ctx, p));
    const all = ctx.detail === 'all';
    const needPage = ctx.detail !== 'brief' && (ctx.parts.chart || (all && (ctx.research || ctx.parts.media)));
    if (needPage) {
        const history = ctx.parts.history ? ctx.personHistory?.(id) : undefined;
        const page = preparePersonPageData(ctx.tree, pageOptions(ctx, id), { protected: ctx.protectedTree, ...(history ? { history } : {}) });
        if (ctx.parts.chart) {
            const chart = personBookChartHtml(page, ctx.now, BOOK_TEXT_WIDTH);
            if (chart) parts.push(`<div class="book-chart">${chart}</div>`);
            parts.push(personBookTimelineHtml(page, pageOptions(ctx, id), {
                rows: ctx.detail === 'all' ? 'all' : 'main',
                // "All" shows every excerpt in a grid of three below the timeline instead.
                figures: ctx.parts.media && !all,
                people: ctx.detail === 'all',
                historyMax: ctx.parts.history ? (ctx.detail === 'all' ? 6 : 3) : 0,
                moreChildren: B.moreChildren,
                cite: sid => ctx.sources.cite(sid),
            }));
        }
        if (all && ctx.parts.media) {
            const clips = personBookClipsHtml(page, pageOptions(ctx, id), sid => ctx.sources.cite(sid));
            if (clips) parts.push(clips);
        }
        if (ctx.research && all) {
            const r = personBookResearchHtml(page, pageOptions(ctx, id));
            if (r) parts.push(`<div class="book-research"><h4 class="book-sub">${esc(B.forResearchers)}</h4>${r}</div>`);
        }
    }
    if (ctx.notes && p.notes?.trim()) {
        const text = cleanWorkNote(p.notes);
        const body = text ? proseHtml(text, { softBreak: 'space', dropStrayMarks: true, headingLevel: 5 }) : '';
        if (body) parts.push(`<div class="book-notes"><h4 class="book-sub">${esc(B.notes)}</h4>${body}</div>`);
    }
    // Every other source the person cites, after the heading's own (all of them get a number in the book).
    ctx.sources.citeAll(personSourceIds(p));
    return `<section class="book-person">${parts.join('')}</section>`;
}

// ─── A family (§5.4) ────────────────────────────────────────────────────────

function storyBlock(ctx: BookCtx, story: Story, who: string, owner: { person: Person } | { couple: Partnership }): string {
    const body = proseHtml(story.text, { title: story.title, headingLevel: 5, softBreak: 'space', dropStrayMarks: true });
    if (!body) return '';
    const banner = ctx.extras?.banner?.(story, owner) ?? '';
    const title = story.title ? ` <span class="book-story-title">${esc(story.title)}</span>` : '';
    const approve = story.status === 'draft' && 'person' in owner ? ctx.extras?.approve?.(owner.person) ?? '' : '';
    return `<div class="book-story">${banner}<h4>${who}${title}</h4>${body}${approve}</div>`;
}

function coupleEventsHtml(ctx: BookCtx, u: Partnership): string {
    const S = T(ctx);
    const B = S.book;
    const events = sortCoupleEvents(u.events ?? []);
    if (!events.length) return '';
    const rows = events.map(ev => {
        const label = ev.type === 'custom' && ev.customLabel?.trim() ? ev.customLabel.trim() : S.partnerEvents.types[ev.type];
        const whereText = [ev.place?.trim(), ev.address?.trim()].filter(Boolean).join(' ');
        const people = ctx.detail === 'all' ? (ev.participants ?? []).map(part => {
            const linked = part.personId ? ctx.tree.persons[part.personId] : undefined;
            const who = linked ? shownNameOrEmpty(linked) : (part.name ?? '').trim();
            return who ? (part.note?.trim() ? `${who} (${part.note.trim()})` : who) : '';
        }).filter(Boolean) : [];
        const list = people.length > 1 ? `${people.slice(0, -1).join(', ')} ${B.and} ${people[people.length - 1]}` : people.join('');
        const note = ev.note?.trim() ? stripResearchIds(ev.note.trim()).text : '';
        const text = [`${[label, whereText].filter(Boolean).join(', ')}.`, list ? B.eventWitnesses(list) : '', note ? (/[.!?…]$/.test(note) ? note : `${note}.`) : ''].filter(Boolean).join(' ');
        const date = ev.date ? formatFlexDate(ev.date, ctx.lang) : S.partnerEvents.noDate;
        return `<div class="book-ce"><span>${esc(date)}</span><span>${esc(text)}${ctx.sources.citeAll(ev.sourceIds)}</span></div>`;
    }).join('');
    return `<div class="book-section book-couple-events"><h3 class="book-sub">${esc(S.partnerEvents.bookTitle)}</h3>${rows}</div>`;
}

function childRelation(ctx: BookCtx, c: Person, u: Partnership): string {
    const B = T(ctx).book;
    const out: string[] = [];
    for (const type of ['adoptive', 'step', 'foster'] as const) {
        const has1 = c.parentRelTypes?.[u.person1Id] === type, has2 = c.parentRelTypes?.[u.person2Id] === type;
        if (!has1 && !has2) continue;
        const label = B.childRel[type];
        if (has1 && has2) { out.push(label); continue; }
        const parent = person(ctx, has1 ? u.person1Id : u.person2Id);
        const pn = parent ? shownNameOrEmpty(parent) : '';
        out.push(pn ? B.childRelOf(label, pn) : label);
    }
    return out.join(', ');
}

function childrenHtml(ctx: BookCtx, u: Partnership, ch: BookChapter): string {
    const B = T(ctx).book;
    const seen = new Set<string>();
    const rows: string[] = [];
    for (const cid of sortByBirth(ctx.tree, [...u.childIds])) {
        const c = person(ctx, cid);
        if (!c || c.isPlaceholder) continue;
        const key = `${shownNameOrEmpty(c)}|${c.birthDate ?? ''}|${c.deathDate ?? ''}`;
        if (!c.birthDate && !c.deathDate && seen.has(key)) continue;
        seen.add(key);
        const years = bookYears(c);
        const rel = childRelation(ctx, c, u);
        let ref = '';
        const own = ctx.model.ownChapter.get(cid);
        const sameLine = !ch.rodId || rodOfPerson(ctx, cid) === ch.rodId;
        if (own !== undefined && sameLine) {
            ref = chapterRef(ctx, own, true);
        } else if (rodShown(ctx, cid)) {
            const out = marriedInto(ctx.model.index, cid).filter(m => m.rodId !== ch.rodId);
            if (out.length && ch.rodId) {
                const target = ctx.model.chapterOf.get(out[0].partnershipId);
                ref = `${esc(B.marriedInto[gKey(c)](rodLabelOf(ctx, out[0].rodId)))} `
                    + (target ? chapterRef(ctx, target.no, true) : `<span class="is-out">${esc(B.outsideBook)}</span>`);
            } else if (own !== undefined) {
                ref = chapterRef(ctx, own, true);
            }
        } else if (own !== undefined) {
            ref = chapterRef(ctx, own, true);
        }
        rows.push(`<li class="book-child"><span>${bookName(ctx, cid)}${years ? `, ${esc(years)}` : ''}${rel ? ` <span class="book-muted">— ${esc(rel)}</span>` : ''}</span><span class="book-child-ref">${ref}</span></li>`);
    }
    return rows.length ? `<div class="book-section book-children"><h3 class="book-sub">${esc(B.children)}</h3><ul>${rows.join('')}</ul></div>` : '';
}

function chapterSourcesHtml(ctx: BookCtx, n: number): string {
    const B = T(ctx).book;
    const ids = ctx.sources.ofChapter(n);
    if (!ids.length) return '';
    const rows = ids.map(id => {
        const s = ctx.sources.source(id)!;
        const short = [s.title, s.reference].filter(x => !!x?.trim()).map(x => esc(x!.trim())).join(', ');
        return `<p><span class="book-pn">P${ctx.sources.no.get(id)}</span>${short}</p>`;
    }).join('');
    return `<div class="book-section book-chapter-sources"><h3 class="book-sub">${esc(B.chapterSources)}</h3>${rows}<p class="book-muted">${esc(B.chapterSourcesNote)}</p></div>`;
}

/** One family: its chapter (the heading, the partners, the stories, the children, the chapter's sources). */
export function familyChapterHtml(ch: BookChapter, ctx: BookCtx): string {
    const B = T(ctx).book;
    const u = ctx.tree.partnerships[ch.unionId];
    if (!u) return '';
    ctx.sources.chapter = ch.no;
    const ids = couple(ctx, u);
    const marriage = marriageText(ctx, u);
    const line = marriage ? `<div class="book-family-line">${marriage}${ctx.sources.citeAll(u.sourceIds)}</div>` : '';
    const origins = ids.map(id => {
        const n = ctx.model.birthChapter.get(id);
        if (n === undefined || n === ch.no) return '';
        const p = person(ctx, id)!;
        return `<div class="book-family-line book-muted">${esc(B.childOf[gKey(p)]('\u0000', n)).replace('\u0000', bookName(ctx, id)).replace(esc(B.chapterRef(n)), chapterRef(ctx, n))}</div>`;
    }).join('');
    const head = `<header class="book-family-head"><div class="book-kicker">${esc(B.chapterKicker(ch.no, ch.gen))}</div>`
        + `<h2>${pairName(ctx, u)}</h2>${line}${origins}</header>`;
    const people = ids.map(id => {
        const fromRodId = ch.rodId && ch.memberId !== id ? birthRodNamed(ctx, id) : null;
        const fromRod = fromRodId && fromRodId !== ch.rodId
            ? { label: rodLabelOf(ctx, fromRodId), ...(ctx.model.birthChapter.get(id) ? { chapter: ctx.model.birthChapter.get(id)! } : {}) }
            : undefined;
        return personBookHtml(id, ctx, { chapter: ch.no, ...(fromRod ? { fromRod } : {}) });
    });
    const partners = ctx.detail === 'brief' && people.length === 2
        ? `<div class="book-pair">${people.join('')}</div>` : people.join('');
    const stories: string[] = [];
    if (ctx.parts.story) {
        for (const id of ids) {
            const p = person(ctx, id)!;
            if (p.story?.text?.trim() && ctx.described.get(id) === ch.no && !shielded(ctx, id)) stories.push(storyBlock(ctx, p.story, bookName(ctx, id), { person: p }));
        }
        if (u.story?.text?.trim()) {
            const years = coupleStoryYears(ctx.tree, u, T(ctx).personPage.story.until);
            stories.push(storyBlock(ctx, u.story, `${pairName(ctx, u)}${years ? ` · ${esc(years)}` : ''}`, { couple: u }));
        }
    }
    const storyHtml = stories.filter(Boolean).length
        ? `<div class="book-section"><h3 class="book-sub">${esc(B.stories)}</h3>${stories.join('')}</div>` : '';
    const events = ctx.detail === 'brief' ? '' : coupleEventsHtml(ctx, u);
    const children = childrenHtml(ctx, u, ch);
    const sources = chapterSourcesHtml(ctx, ch.no);
    ctx.sources.chapter = 0;
    return `<article class="book-family${ch.sub ? ' is-sub' : ''}" id="kap-${ch.no}">${head}${events}`
        + `<div class="book-section book-partners">${partners}</div>${storyHtml}${children}${sources}</article>`;
}

// ─── The back of the book ───────────────────────────────────────────────────

/** "Other families" (§5.9): the small lineages of a whole-tree book, without chapters. */
export function smallRodsHtml(list: readonly Rod[], ctx: BookCtx): string {
    if (!list.length) return '';
    const S = T(ctx);
    const B = S.book;
    const items = [...list].sort((a, b) => a.surname.localeCompare(b.surname, ctx.lang)).map(rod => {
        const founder = person(ctx, rod.founderId);
        const period = rod.period ? (rod.period.from === rod.period.to ? String(rod.period.from) : `${rod.period.from}–${rod.period.to}`) : '';
        const head = [`<strong>${esc(rodLabelOf(ctx, rod.id) || '?')}</strong>`, esc(period), esc(B.persons(rod.realMemberCount))].filter(Boolean).join(' · ');
        const year = founder && !shielded(ctx, rod.founderId) ? (yearOf(founder.birthDate) ?? rod.founderYear) : null;
        const oldest = founder ? esc(B.smallRodOldest('\u0000', year !== null && year !== undefined ? String(year) : '')).replace('\u0000', bookName(ctx, rod.founderId)) : '';
        let linked = '';
        for (const id of rod.memberIds) {
            if (!rodShown(ctx, id)) continue;
            const m = marriedInto(ctx.model.index, id).find(x => ctx.model.chapterOf.has(x.partnershipId));
            if (m) {
                const n = ctx.model.chapterOf.get(m.partnershipId)!.no;
                linked = ` ${esc(B.smallRodLinked(rodLabelOf(ctx, m.rodId)))} ${chapterRef(ctx, n, true)}.`;
                break;
            }
        }
        return `<p class="book-small-rod">${head}<br>${oldest}${linked}</p>`;
    }).join('');
    return `<h2>${esc(B.parts.smallRods)}</h2><p>${esc(B.smallRodsIntro(4))}</p>${items}`;
}

/** A scan's address as printed (§5.7): without the scheme when short, else `{domain}/…/{last 2 parts}`. */
export function printedUrl(url: string): string {
    const bare = url.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '').replace(/\/$/, '');
    if (bare.length <= 48) return bare;
    const [domain, ...rest] = bare.split('/');
    const parts = rest.filter(Boolean);
    return parts.length <= 2 ? bare : `${domain}/…/${parts.slice(-2).join('/')}`;
}

/** The list of sources at the end (§5.7): P-numbers by first occurrence, full citation, scan, back references. */
export function sourcesHtml(ctx: BookCtx): string {
    const B = T(ctx).book;
    const ids = [...ctx.sources.no.keys()];
    if (!ids.length) return '';
    const rows = ids.map(id => {
        const s = ctx.sources.source(id)!;
        const full = [s.title, s.repository, s.reference].filter(x => !!x?.trim()).map(x => esc(x!.trim())).join(', ');
        const href = safeHttpUrl(s.url);
        const scan = href ? `<span class="book-source-scan">${esc(B.scan)} <a href="${esc(href)}" data-print="${esc(printedUrl(href))}"><span>${esc(href)}</span></a></span>` : '';
        const back = ctx.sources.chapters.get(id) ?? [];
        const refs = back.length ? `<span class="book-source-refs">${back.map(n => chapterRef(ctx, n)).join(', ')}</span>` : '';
        return `<p class="book-source"><span class="book-pn">P${ctx.sources.no.get(id)}</span>${full}${scan}${refs}</p>`;
    }).join('');
    return `<h2>${esc(B.sources)}</h2><div class="book-sources${ids.length >= 40 ? ' is-long' : ''}">${rows}</div>`;
}

/** The index of people (§5.10): birth surnames, married-name cross-references, chapters (own family bold). */
export function indexHtml(ctx: BookCtx): string {
    const B = T(ctx).book;
    const sortKey = (s: string): string => s.replace(/\[\?\]/g, '').replace(/\s+/g, ' ').trim();
    const entries: { key: string; letter: string; html: string }[] = [];
    for (const id of ctx.model.personIds) {
        const p = person(ctx, id);
        if (!p || p.isPlaceholder) continue;
        const last = p.lastName?.trim() ?? '';
        const first = p.firstName?.trim() ?? '';
        const name = [last, first].filter(Boolean).join(' ') || '?';
        const married = p.marriedSurname?.trim();
        const marriedNote = married && married !== last ? `, ${(p.primaryName === 'birth' ? B.indexFormer : B.indexMarried)(married)}` : '';
        const years = bookYears(p);
        const own = ctx.model.ownChapters.get(id) ?? [];
        const all = [...new Set([...own, ...(ctx.model.birthChapter.has(id) ? [ctx.model.birthChapter.get(id)!] : [])])].sort((a, b) => a - b);
        const refs = all.map(n => own.includes(n) ? `<b>${link(ctx, { chapter: n }, String(n))}</b>` : link(ctx, { chapter: n }, String(n))).join(', ');
        const text = `${esc(name)}${esc(marriedNote)}${years ? ` (${esc(years)})` : ''}`;
        const letter = last ? sortKey(last).charAt(0).toLocaleUpperCase(ctx.lang) : '';
        entries.push({
            key: `${last ? '0' : '1'} ${sortKey(last)} ${sortKey(first)}`, letter,
            html: refs
                ? `<div class="book-index-row"><span class="book-index-name">${text}</span><span class="book-index-dots"></span><span class="book-index-refs">${refs}</span></div>`
                : `<div class="book-index-row"><span class="book-index-name">${text}</span></div>`,
        });
        if (married && married !== last && last) {
            const see = [married, first].filter(Boolean).join(' ');
            entries.push({ key: `0 ${sortKey(married)} ${sortKey(first)}`, letter: sortKey(married).charAt(0).toLocaleUpperCase(ctx.lang), html: `<div class="book-index-row book-index-see">${esc(B.indexSee(see, name))}</div>` });
        }
    }
    entries.sort((a, b) => a.key.localeCompare(b.key, ctx.lang));
    let prev: string | null = null;
    const out: string[] = [];
    for (const e of entries) {
        const letter = e.letter || B.noSurname;
        if (letter !== prev) { out.push(`<div class="book-index-letter">${esc(letter)}</div>`); prev = letter; }
        out.push(e.html);
    }
    return `<h2>${esc(B.index)}</h2><div class="book-index">${out.join('')}</div>`;
}
