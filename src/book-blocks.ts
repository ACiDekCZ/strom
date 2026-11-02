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

import { Partnership, PartnershipId, Person, PersonId, Source, StromData, Story, personSourceIds } from './types.js';
import { PrivacyMode } from './privacy.js';
import { getStringsForLang } from './strings.js';
import { formatFlexDate, parseFlexDate, yearOf } from './dates.js';
import { sortCoupleEvents } from './events.js';
import { shownNameOrEmpty } from './person-name.js';
import { feminineForm, czechRulesApply } from './surnames.js';
import { safeHttpUrl } from './validation.js';
import { proseHtml, coupleStoryYears } from './story-text.js';
import { marriedInto, placeSpans, Rod, RodId, rodGenerations, rodNameForms, rodPlaceSpans, sortByBirth } from './lineage.js';
import { placeKey } from './places.js';
import {
    PERSON_PAGE_ALL_GROUPS, PersonPageContext, PersonPageOptions, ProtectedPersonPageTree,
    cleanWorkNote, personBookChartHtml, personBookClipsHtml, personBookResearchHtml, personBookTimelineHtml, personPageDate,
    preparePersonPageData, stripResearchIds,
} from './person-page.js';
import { BookChapter, BookModel } from './book-model.js';
import { BookDetail, BookLang, BookParts } from './book-options.js';

export type BookMode = 'book' | 'app' | 'file';
/**
 * What a reference points to: a chapter or the lineage part of the book, a
 * person, or (pages of a set, spec 026 §0.8) a family or a lineage by id.
 */
export type BookLinkTarget = { chapter: number } | { rod: number } | { person: PersonId } | { family: PartnershipId } | { rodId: RodId } | { rodTimeline: RodId };

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
    /**
     * Where a reference leads, null for plain text: an href in the book and
     * a saved file ('#kap-5', '#rodina-…'), the `data-sp-open` value in the
     * app's window ('family:{id}').
     */
    linkTo: (target: BookLinkTarget, ctx: BookCtx) => string | null;
    /** Pages of a set (spec 026 §0.3): every id of a block as `{idPrefix}--{id}`; none in the book. */
    idPrefix?: string;
    /**
     * Pages of a set (spec 026 §3.5): where a place of a lineage's header
     * leads (`#slug--anchor` in the file, a `data-sp-open` value in the
     * window); none: the page's own "Where the line lived".
     */
    placeLink?: (placeKey: string) => string | null;
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
    /**
     * Pages of a set in the app's window (spec 026 §3.3, §9.3): the tag after
     * a living person's years (' <span class="sp-living">living</span>'), ''
     * for others; none in the book and in a saved file.
     */
    markLiving?: (id: PersonId) => string;
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

/** A founder's year as the overview writes it: "1810", "asi 1810" for an approximate date or a span, '' without a date. */
function founderYear(ctx: BookCtx, date: string | undefined): string {
    const d = parseFlexDate(date);
    if (!d) return '';
    return d.qualifier !== '' || !!d.end ? T(ctx).treeOverview.rods.approx(d.year) : String(d.year);
}

/** A lineage founder's note after the name, " (* asi 1810, Place)", as the lineage header and the hub card write it; '' when shielded or without a birth. */
export function founderNote(ctx: BookCtx, id: PersonId): string {
    const p = person(ctx, id);
    if (!p || shielded(ctx, id)) return '';
    const bits = [founderYear(ctx, p.birthDate), p.birthPlace?.trim() ?? ''].filter(Boolean);
    return bits.length ? ` (* ${esc(bits.join(', '))})` : '';
}

/** A living person under a privacy other than full: no details. */
function shielded(ctx: BookCtx, id: PersonId): boolean {
    return ctx.living.has(id) && ctx.privacy !== 'full';
}

/** May the person's lineage be named (§3.4: not for the living under initials or hidden names)? */
function rodShown(ctx: BookCtx, id: PersonId): boolean {
    return !(ctx.living.has(id) && (ctx.privacy === 'initials' || ctx.privacy === 'anonymous'));
}

/** An id of a block, with the set's page prefix when there is one. */
export function bookId(ctx: BookCtx, id: string): string {
    return ctx.idPrefix ? `${ctx.idPrefix}--${id}` : id;
}

/**
 * A reference as a link: `<a href>` in the book, `<a class="pp-link" href>`
 * in a saved file of pages, `<button class="pp-link" data-sp-open>` in the
 * app's window (spec 026 §0.8); plain text where `linkTo` has nothing.
 */
export function bookLink(ctx: BookCtx, target: BookLinkTarget, html: string): string {
    return link(ctx, target, html);
}

function link(ctx: BookCtx, target: BookLinkTarget, html: string): string {
    const to = ctx.linkTo(target, ctx);
    if (!to) return html;
    if (ctx.mode === 'book') return `<a href="${esc(to)}">${html}</a>`;
    if (ctx.mode === 'app') return `<button type="button" class="pp-link" data-sp-open="${esc(to)}">${html}</button>`;
    return `<a class="pp-link" href="${esc(to)}">${html}</a>`;
}

/** The couple of a chapter, as "Josef and Anna" (escaped), or null. */
function chapterCouple(ctx: BookCtx, n: number): { unionId: PartnershipId; names: string } | null {
    const ch = ctx.model.chapters.find(c => c.no === n);
    const u = ch ? ctx.tree.partnerships[ch.unionId] : undefined;
    return ch && u ? { unionId: ch.unionId, names: pairFirstNames(ctx, u) } : null;
}

/**
 * "→ ch. 5" in the book; on pages of a set the family itself, "→ the family
 * of Josef and Anna" (`word` false: just "Josef and Anna"), linked to its page.
 */
function chapterRef(ctx: BookCtx, n: number, arrow = false, word = true): string {
    const B = T(ctx).book;
    const fam = ctx.mode === 'book' ? null : chapterCouple(ctx, n);
    if (!fam) return link(ctx, { chapter: n }, `${arrow ? '→ ' : ''}${esc(B.chapterRef(n))}`);
    const text = word ? esc(T(ctx).familyPages.familyRef('\u0000')).replace('\u0000', fam.names) : fam.names;
    return link(ctx, { family: fam.unionId }, `${arrow ? '→ ' : ''}${text}`);
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
export function birthRodNamed(ctx: BookCtx, id: PersonId): RodId | null {
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
export function rodOverviewHtml(rod: Rod, ctx: BookCtx, page: { title?: string } = {}): string {
    // A page of a set (spec 026 §1.2): the page's header and charts, the same data.
    if (ctx.mode !== 'book') return pageLineHeadHtml(rodPageLine(rod, ctx, page.title), ctx);
    const S = T(ctx);
    const B = S.book;
    const label = rodLabelOf(ctx, rod.id);
    const founder = person(ctx, rod.founderId);
    const rows: [string, string][] = [];
    if (founder) {
        const bits: string[] = [];
        if (!shielded(ctx, rod.founderId)) {
            const b = founderYear(ctx, founder.birthDate), d = founderYear(ctx, founder.deathDate);
            if (b || founder.birthPlace) bits.push(`* ${[b, founder.birthPlace].filter(x => !!x).join(' ')}`);
            if (d || founder.deathPlace) bits.push(`† ${[d, founder.deathPlace].filter(x => !!x).join(' ')}`);
        }
        rows.push([B.founder[gKey(founder)], `${bookName(ctx, rod.founderId)}${bits.length ? ` (${esc(bits.join(', '))})` : ''}`]);
    }
    if (rod.period) rows.push([B.period, esc(B.periodValue(rod.period.from, rod.period.to))]);
    if (rodShown(ctx, rod.founderId)) {
        const forms = rod.forms.length ? rod.forms : [rod.surname];
        let text = esc(forms.join(', '));
        if (czechRulesApply(ctx.model.index.data)) {
            // A female form some member carries is named once, among the female forms.
            const fem = [...new Set(forms.map(f => feminineForm(f)).filter((f): f is string => !!f))];
            const own = forms.filter(f => !fem.includes(f));
            if (fem.length && own.length) text = `${esc(own.join(', '))}; ${esc(B.femaleForms(fem.join(', ')))}`;
        }
        rows.push([B.nameForms, text]);
    }
    rows.push([B.inRod, esc(B.inRodValue(rod.realMemberCount, rod.realSpouseCount, rod.generations, rod.familyIds.length))]);
    // Lines only: a spouse who married in alone (no parents recorded) is not a line of their own.
    const linked = new Set<RodId>();
    const isLine = (id: RodId | null): id is RodId => !!id && id !== rod.id && ctx.model.index.rods.get(id)?.solitary === false;
    for (const s of rod.spouses) if (isLine(s.birthRodId) && rodShown(ctx, s.personId)) linked.add(s.birthRodId);
    for (const id of rod.memberIds) {
        if (!rodShown(ctx, id)) continue;
        for (const m of marriedInto(ctx.model.index, id)) if (isLine(m.rodId)) linked.add(m.rodId);
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

export function diedYoung(p: Person): boolean {
    const b = yearOf(p.birthDate), d = yearOf(p.deathDate);
    return b !== null && d !== null && d - b < 15 && p.partnerships.length === 0;
}

/** The lineage's line tree, variant B (§5.3): one row per member, indented by generation. */
export function rodLineageHtml(rod: Rod, ctx: BookCtx, opts: { breakBefore?: boolean; id?: string } = {}): string {
    // A page of a set (spec 026 §1.4): generation by generation.
    if (ctx.mode !== 'book') return pageLineGenerationsHtml(rodPageLine(rod, ctx), ctx);
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
                // An unknown partner is left out (no "⚭ ?"); the wedding year alone still says there was one.
                const known = !!op && !op.isPlaceholder;
                if (!known && y === null) return '';
                return `<span class="book-marr">⚭ ${[y !== null ? String(y) : '', known ? `${bookName(ctx, other)}${rodTxt}` : ''].filter(Boolean).join(' ')}</span>`;
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
    return `<section class="book-rod-lineage${opts.breakBefore ? ' book-break' : ''}"${opts.id ? ` id="${esc(bookId(ctx, opts.id))}"` : ''}><h2>${esc(B.parts.tree)}</h2>${rows.join('')}</section>`;
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
        if (ctx.mode !== 'book' && chapterCouple(ctx, n)) {
            return `<div class="book-family-line book-muted">${esc(T(ctx).familyPages.childOf[gKey(p)]('\u0000', '\u0001')).replace('\u0000', bookName(ctx, id)).replace('\u0001', chapterRef(ctx, n, false, false))}</div>`;
        }
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
    return `<article class="book-family${ch.sub ? ' is-sub' : ''}" id="${esc(bookId(ctx, `kap-${ch.no}`))}">${head}${events}`
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
        // Pages of a set (spec 026 §1.7): the name leads to the person's page, no chapters.
        const pages = ctx.mode !== 'book';
        const refs = pages ? '' : all.map(n => own.includes(n) ? `<b>${link(ctx, { chapter: n }, String(n))}</b>` : link(ctx, { chapter: n }, String(n))).join(', ');
        const text = pages
            ? `${link(ctx, { person: id }, esc(name))}${esc(marriedNote)}${years ? ` (${esc(years)})` : ''}`
            : `${esc(name)}${esc(marriedNote)}${years ? ` (${esc(years)})` : ''}`;
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
    // A page of a set has its own heading.
    if (ctx.mode !== 'book') return `<div class="book-index">${out.join('')}</div>`;
    return `<h2>${esc(B.index)}</h2><div class="book-index">${out.join('')}</div>`;
}

// ─── Pages of a set (spec 026 §1) ───────────────────────────────────────────

/**
 * What a lineage's or a branch's page lays out (§1.2–§1.6): the root (the
 * founder, the ancestor), the members in line order with their generation
 * (I = the root's) and the spouses who married in.
 */
export interface PageLine {
    kind: 'rod' | 'branch';
    /** The lineage (kind 'rod'). */
    rod?: Rod;
    rootId: PersonId;
    /** The heading, plain text. */
    title: string;
    memberIds: PersonId[];
    spouseIds: PersonId[];
    generation: ReadonlyMap<PersonId, number>;
}

function realIn(ctx: BookCtx, id: PersonId | undefined | null): boolean {
    const p = person(ctx, id);
    return !!p && !p.isPlaceholder;
}

/** A lineage as its page lays it out; `title` the set's (default: "Rod {label}"). */
export function rodPageLine(rod: Rod, ctx: BookCtx, title?: string): PageLine {
    const F = T(ctx).familyPages;
    const generation = new Map<PersonId, number>();
    rodGenerations(ctx.model.index, rod.id).forEach((ids, i) => { for (const id of ids) generation.set(id, i + 1); });
    const label = rodLabelOf(ctx, rod.id);
    return {
        kind: 'rod', rod, rootId: rod.founderId,
        title: title ?? (label ? F.rodTitle(label) : F.rodGeneric),
        memberIds: rod.memberIds.filter(id => realIn(ctx, id) && generation.has(id)),
        spouseIds: [...new Set(rod.spouses.map(s => s.personId))].filter(id => realIn(ctx, id)),
        generation,
    };
}

/**
 * A branch (§1.6) as its page lays it out: the generations counted from the
 * root through the members' parent and child links (descendants: I = the
 * ancestor; the children of daughters included, as the selection has them).
 */
export function branchPageLine(ctx: BookCtx, rootId: PersonId, memberIds: readonly PersonId[], spouseIds: readonly PersonId[], title: string): PageLine {
    const members = new Set(memberIds);
    const generation = new Map<PersonId, number>([[rootId, 1]]);
    const queue: PersonId[] = [rootId];
    for (let i = 0; i < queue.length; i++) {
        const id = queue[i];
        const p = person(ctx, id);
        if (!p) continue;
        for (const n of [...p.childIds, ...p.parentIds]) {
            if (members.has(n) && !generation.has(n)) { generation.set(n, generation.get(id)! + 1); queue.push(n); }
        }
    }
    return {
        kind: 'branch', rootId, title,
        memberIds: memberIds.filter(id => realIn(ctx, id) && generation.has(id)),
        spouseIds: spouseIds.filter(id => realIn(ctx, id)),
        generation,
    };
}

/** The unions of the line's members, each once, in the members' order. */
function lineUnions(line: PageLine, ctx: BookCtx): Partnership[] {
    const out: Partnership[] = [];
    const seen = new Set<PartnershipId>();
    for (const id of line.memberIds) {
        for (const uid of person(ctx, id)?.partnerships ?? []) {
            const u = ctx.tree.partnerships[uid];
            if (u && !seen.has(uid)) { seen.add(uid); out.push(u); }
        }
    }
    return out;
}

/** The line's families as its counts name them: a lineage's own (`rod.familyIds`), a branch's every union of a member. */
function lineFamilyCount(line: PageLine, ctx: BookCtx): number {
    return line.rod ? line.rod.familyIds.length : lineUnions(line, ctx).length;
}

/**
 * First and last year of the line's records the page may show: members and
 * spouses, their events and the members' weddings; a protected living person
 * and a union with one say nothing (§5: the period ends with the last
 * unprotected record).
 */
export function pageLinePeriod(line: PageLine, ctx: BookCtx): { from: number; to: number } | null {
    let from = Infinity, to = -Infinity;
    const note = (date: string | undefined): void => {
        const y = yearOf(date);
        if (y === null) return;
        from = Math.min(from, y);
        to = Math.max(to, y);
    };
    for (const id of [...line.memberIds, ...line.spouseIds]) {
        const p = person(ctx, id);
        if (!p || shielded(ctx, id)) continue;
        note(p.birthDate);
        note(p.deathDate);
        for (const ev of p.events ?? []) note(ev.date);
    }
    for (const u of lineUnions(line, ctx)) {
        if (shielded(ctx, u.person1Id) || (u.person2Id && shielded(ctx, u.person2Id))) continue;
        note(u.startDate);
        note(u.endDate);
    }
    return from <= to ? { from, to } : null;
}

/** A common time axis rounded to 50 years (§1.3), positions in per cent. */
function timeAxis(lo: number, hi: number): { a: number; b: number; ticks: number[]; pos: (from: number, to: number) => string } {
    const a = Math.floor(lo / 50) * 50;
    let b = Math.min(2050, Math.ceil(hi / 50) * 50);
    if (b <= a) b = a + 50;
    const ticks = [...new Set([a, Math.round((a + b) / 100) * 50, b])];
    const pos = (from: number, to: number): string => {
        const left = Math.max(0, Math.min(100, ((from - a) / (b - a)) * 100));
        const width = Math.min(100 - left, Math.max(1.2, ((to - from) / (b - a)) * 100));
        return `left:${left.toFixed(1)}%;width:${width.toFixed(1)}%`;
    };
    return { a, b, ticks, pos };
}

/**
 * Where a person's bar ends: the death, else today for the living (a
 * protected living person: the birth year, §1.3), else the birth.
 */
function barEnd(ctx: BookCtx, id: PersonId, p: Person): number | null {
    const d = yearOf(p.deathDate);
    if (d !== null) return d;
    const b = yearOf(p.birthDate);
    if (ctx.living.has(id) && !shielded(ctx, id)) return ctx.now.getFullYear();
    return b;
}

/** The line's places (§1.3, max 6 on the chart, the protected left out). */
function linePlaces(line: PageLine, ctx: BookCtx) {
    const members = new Set(line.memberIds);
    const families = line.rod ? line.rod.familyIds : lineUnions(line, ctx).map(u => u.id);
    return placeSpans(ctx.tree, [...line.memberIds, ...line.spouseIds], families, members, id => shielded(ctx, id));
}

/** The first occupation recorded ('' without one). */
export function occupationOf(p: Person): string {
    for (const e of p.events ?? []) {
        if (e.type !== 'occupation') continue;
        const what = stripResearchIds(e.note?.trim() ?? '').text.trim();
        if (what) return what;
    }
    return '';
}

/** A count as the header writes it: the number in bold ("<strong>48</strong> members"), escaped. */
function statHtml(text: string): string {
    return `<span class="sp-stat">${esc(text).replace(/^(\d+)/, '<strong>$1</strong>')}</span>`;
}

/**
 * A lineage's or a branch's header and its "over time" charts (§1.2, §1.3):
 * kicker, heading, founder / ancestor, counts, name forms, the three main
 * places (linked to the chart of places), then the generations and the
 * places on one time axis.
 */
export function pageLineHeadHtml(line: PageLine, ctx: BookCtx): string {
    const F = T(ctx).familyPages;
    const root = person(ctx, line.rootId);
    const rows: string[] = [];
    let rootHtml = '';
    if (root && !root.isPlaceholder) {
        const name = link(ctx, { person: line.rootId }, bookName(ctx, line.rootId));
        let post = '';
        if (line.kind === 'rod') {
            post = founderNote(ctx, line.rootId);
        } else {
            const y = bookYears(root);
            if (y) post = ` (${esc(y)})`;
        }
        const word = (line.kind === 'rod' ? F.founder : F.ancestor)[gKey(root)];
        rootHtml = `<p class="sp-founder">${esc(word)} ${name}${post}</p>`;
    }
    const period = pageLinePeriod(line, ctx);
    const gens = new Set(line.memberIds.map(id => line.generation.get(id) ?? 1)).size;
    const stats = [
        period ? `<span class="sp-stat"><strong>${period.from}–${period.to}</strong></span>` : '',
        line.rod ? statHtml(F.nMembers(line.rod.realMemberCount)) : statHtml(F.nDesc(Math.max(0, line.memberIds.length - 1))),
        statHtml(F.nSpouses(line.rod ? line.rod.realSpouseCount : line.spouseIds.length)),
        statHtml(F.nGens(gens)),
        statHtml(F.nFams(lineFamilyCount(line, ctx))),
    ].filter(Boolean).join(' · ');
    if (line.rod && rodShown(ctx, line.rod.founderId)) {
        const nf = rodNameForms(line.rod, ctx.model.index.data);
        if (nf.forms.length > 1) {
            const fem = nf.feminine.length ? `<span class="sp-faint"> · ${esc(F.feminine(nf.feminine.join(', ')))}</span>` : '';
            rows.push(`<dt>${esc(F.forms)}</dt><dd>${esc(nf.forms.join(' · '))}${fem}</dd>`);
        }
    }
    const spans = linePlaces(line, ctx);
    if (spans.length) {
        const to = `#${bookId(ctx, 'sp-places')}`;
        const names = spans.slice(0, 3).map(s => {
            const key = esc(placeKey(s.name));
            const target = ctx.placeLink ? ctx.placeLink(placeKey(s.name)) : (ctx.mode === 'file' ? to : null);
            if (target && ctx.mode === 'file') return `<a class="pp-link sp-place" href="${esc(target)}" data-sp-place="${key}">${esc(s.name)}</a>`;
            if (target && ctx.mode === 'app') return `<button type="button" class="pp-link sp-place" data-sp-open="${esc(target)}" data-sp-place="${key}">${esc(s.name)}</button>`;
            return `<span class="sp-place" data-sp-place="${key}">${esc(s.name)}</span>`;
        });
        const more = spans.length > 3 ? ` <span class="sp-faint">${esc(F.morePlaces(spans.length - 3))}</span>` : '';
        rows.push(`<dt>${esc(F.places)}</dt><dd>${names.join(', ')}${more}</dd>`);
    }
    const kicker = line.kind === 'rod' ? F.kRod : F.kBranch;
    return `<header class="sp-head"><div class="sp-kicker">${esc(kicker)}</div><h1 class="sp-h1">${esc(line.title)}</h1>${rootHtml}`
        + `<p class="sp-stats">${stats}</p>${rows.length ? `<dl class="sp-facts">${rows.join('')}</dl>` : ''}</header>`
        + lineTimeHtml(line, ctx, spans);
}

/** "Rod v čase" (§1.3): generations I–N and the places on a common axis rounded to 50 years. */
function lineTimeHtml(line: PageLine, ctx: BookCtx, spans: ReturnType<typeof placeSpans>): string {
    const F = T(ctx).familyPages;
    const byGen = new Map<number, { from: number; to: number }>();
    for (const id of line.memberIds) {
        const p = person(ctx, id)!;
        const b = yearOf(p.birthDate);
        const e = barEnd(ctx, id, p);
        const from = b ?? e;
        if (from === null) continue;
        const g = line.generation.get(id) ?? 1;
        const cur = byGen.get(g);
        const to = Math.max(from, e ?? from);
        byGen.set(g, cur ? { from: Math.min(cur.from, from), to: Math.max(cur.to, to) } : { from, to });
    }
    const places = spans.slice(0, 6);
    const all = [...byGen.values(), ...places];
    if (!all.length) return '';
    const ax = timeAxis(Math.min(...all.map(x => x.from)), Math.max(...all.map(x => x.to)));
    const ticks = `<div class="sp-ticks" aria-hidden="true">${ax.ticks.map(t => `<span>${t}</span>`).join('')}</div>`;
    const bar = (from: number, to: number): string =>
        `<span class="sp-axis"><span class="sp-bar" style="${ax.pos(from, to)}" title="${from}–${to}"></span></span>`;
    const genRows = [...byGen.keys()].sort((a, b) => a - b).map(g => {
        const s = byGen.get(g)!;
        return `<div class="sp-bar-row"><span class="sp-bar-k sp-bar-gen">${roman(g)}</span>${bar(s.from, s.to)}</div>`;
    }).join('');
    const placeRows = places.map(s =>
        `<div class="sp-bar-row sp-bar-row--place"><span class="sp-bar-k"><span class="sp-bar-name">${esc(s.name)}</span> <span class="sp-bar-n">${s.persons}</span></span>${bar(s.from, s.to)}</div>`).join('');
    const more = spans.length > 6 ? `<p class="sp-faint sp-more">${esc(F.morePlaces(spans.length - 6))}</p>` : '';
    const branch = line.kind === 'branch';
    const gensChart = genRows ? `<div class="sp-chart"><h3 class="sp-h3">${esc(F.gens)}</h3>${genRows}${ticks}</div>` : '';
    const placesChart = placeRows
        ? `<div class="sp-chart" id="${esc(bookId(ctx, 'sp-places'))}"><h3 class="sp-h3">${esc(branch ? F.placeSpansBranch : F.placeSpans)}</h3>${placeRows}${ticks}${more}</div>`
        : '';
    // The line's timeline page, when the set has it (1102 §5).
    const tl = line.rod && ctx.linkTo({ rodTimeline: line.rod.id }, ctx) ? `<p class="sp-tl-go">${link(ctx, { rodTimeline: line.rod.id }, esc(F.tlLink))}</p>` : '';
    return `<section class="sp-block sp-time" id="${esc(bookId(ctx, 'sp-time'))}"><h2 class="sp-h2">${esc(branch ? F.timelineBranch : F.timeline)}</h2>`
        + `<div class="sp-charts">${gensChart}${placesChart}</div>${tl}</section>`;
}

/** A recorded marriage (not a partnership without one). */
function isWedding(u: Partnership): boolean {
    return u.status === 'married' || u.status === 'divorced';
}

/**
 * "Linie po generacích" (§1.4): per generation a roman numeral with the
 * count and the birth years, a row per member (name, years, place,
 * occupation; the parents' family; died in childhood) and the member's
 * unions under it (partner, the partner's lineage, the children in a fold
 * that is open without the script, the family's page). A protected living
 * person is the name and the birth year only (§5).
 */
export function pageLineGenerationsHtml(line: PageLine, ctx: BookCtx): string {
    const F = T(ctx).familyPages;
    const members = new Set(line.memberIds);
    // The union each member was born of, among the members' own unions.
    const parentUnion = new Map<PersonId, Partnership>();
    for (const u of lineUnions(line, ctx)) {
        for (const c of u.childIds ?? []) if (members.has(c) && !parentUnion.has(c)) parentUnion.set(c, u);
    }
    const byGen = new Map<number, PersonId[]>();
    for (const id of line.memberIds) {
        const g = line.generation.get(id) ?? 1;
        byGen.set(g, [...(byGen.get(g) ?? []), id]);
    }
    const gens = [...byGen.keys()].sort((a, b) => a - b).map(g => {
        const ids = byGen.get(g)!;
        const births = ids.map(id => yearOf(person(ctx, id)?.birthDate)).filter((y): y is number => y !== null);
        const meta = F.genMeta(ids.length, births.length ? Math.min(...births) : null, births.length ? Math.max(...births) : null);
        const rows = ids.map(id => lineRowHtml(id, line, ctx, members, parentUnion)).join('');
        return `<div class="sp-gen"><h3 class="sp-gen-h"><span class="sp-roman">${roman(g)}</span> <span class="sp-gen-meta">${esc(meta)}</span></h3><div class="sp-rows">${rows}</div></div>`;
    }).join('');
    if (!gens) return '';
    return `<section class="sp-block sp-line" id="${esc(bookId(ctx, 'sp-line'))}"><h2 class="sp-h2">${esc(F.line)}</h2>${gens}</section>`;
}

function lineRowHtml(id: PersonId, line: PageLine, ctx: BookCtx, members: ReadonlySet<PersonId>, parentUnion: ReadonlyMap<PersonId, Partnership>): string {
    const F = T(ctx).familyPages;
    const p = person(ctx, id)!;
    const name = link(ctx, { person: id }, bookName(ctx, id));
    const years = bookYears(p);
    const yrs = (years ? ` <span class="sp-yrs">${esc(years)}</span>` : '') + (ctx.markLiving?.(id) ?? '');
    if (shielded(ctx, id)) return `<div class="sp-row sp-row--prot"><p class="sp-row-main">${name}${yrs}</p></div>`;
    const meta = [p.birthPlace?.trim() ?? '', occupationOf(p)].filter(Boolean).join(' · ');
    const young = diedYoung(p);
    let sub = '';
    const pu = parentUnion.get(id);
    const lineParent = pu ? [pu.person1Id, pu.person2Id].find(m => !!m && members.has(m)) : undefined;
    if (pu && lineParent) {
        const fam = ctx.linkTo({ family: pu.id }, ctx)
            ? link(ctx, { family: pu.id }, pairFirstNames(ctx, pu))
            : link(ctx, { person: lineParent }, bookName(ctx, lineParent));
        sub += `<p class="sp-row-sub">${esc(F.childWord[gKey(p)])} · ${fam}</p>`;
    }
    if (young) sub += `<p class="sp-row-note">${esc(F.diedChild[gKey(p)])}</p>`;
    const unions = p.partnerships.map(uid => ctx.tree.partnerships[uid]).filter((u): u is Partnership => !!u)
        .map((u, i) => ({ u, i, y: yearOf(u.startDate) }))
        .sort((a, b) => (a.y ?? Infinity) - (b.y ?? Infinity) || a.i - b.i)
        .map(x => lineUnionHtml(x.u, id, ctx)).filter(Boolean);
    return `<div class="sp-row${young ? ' sp-row--young' : ''}"><p class="sp-row-main">${name}${yrs}${meta ? `<span class="sp-meta"> · ${esc(meta)}</span>` : ''}</p>`
        + `${sub}${unions.length ? `<ul class="sp-unions">${unions.join('')}</ul>` : ''}</div>`;
}

function lineUnionHtml(u: Partnership, memberId: PersonId, ctx: BookCtx): string {
    const F = T(ctx).familyPages;
    const member = person(ctx, memberId)!;
    const otherId = u.person1Id === memberId ? u.person2Id : u.person1Id;
    const known = realIn(ctx, otherId);
    const bits: string[] = [];
    if (known) {
        const y = yearOf(u.startDate);
        const head = y !== null ? `⚭ ${y}` : isWedding(u) ? '⚭' : '';
        const other = person(ctx, otherId)!;
        const oy = bookYears(other);
        const partner = `${link(ctx, { person: otherId }, bookName(ctx, otherId))}${oy ? ` <span class="sp-yrs">(${esc(oy)})</span>` : ''}${ctx.markLiving?.(otherId) ?? ''}`;
        bits.push(head ? `<span class="sp-nw">${head}</span> ${partner}` : partner);
        const otherRod = rodShown(ctx, otherId) && rodShown(ctx, memberId) ? birthRodNamed(ctx, otherId) : null;
        if (otherRod && otherRod !== rodOfPerson(ctx, memberId)) {
            const label = rodLabelOf(ctx, otherRod);
            const text = member.gender === 'female' ? F.toRod(label) : F.birthRod(label);
            bits.push(`<span class="sp-rodref">${link(ctx, { rodId: otherRod }, esc(text))}</span>`);
        }
    } else {
        bits.push(`<span class="sp-faint">${esc(member.gender === 'female' ? F.fatherUnknown : F.motherUnknown)}</span>`);
    }
    const kids = sortByBirth(ctx.tree, (u.childIds ?? []).filter(c => realIn(ctx, c)));
    if (!kids.length && known && isWedding(u)) bits.push(`<span class="sp-faint">${esc(F.noKids)}</span>`);
    if (ctx.linkTo({ family: u.id }, ctx)) bits.push(link(ctx, { family: u.id }, esc(F.famLink)));
    const fold = kids.length
        ? `<details class="sp-kids" open><summary>${esc(F.nKids(kids.length))}</summary><p class="sp-kid-list">`
            + kids.map(k => {
                const ky = bookYears(person(ctx, k));
                return `<span class="sp-kid">${link(ctx, { person: k }, bookName(ctx, k))}${ky ? ` <span class="sp-yrs">${esc(ky)}</span>` : ''}${ctx.markLiving?.(k) ?? ''}</span>`;
            }).join(', ')
            + '</p></details>'
        : '';
    return `<li class="sp-union"><span class="sp-union-line">${bits.join(' · ')}</span>${fold}</li>`;
}
