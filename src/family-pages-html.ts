/**
 * The family pages as one self-contained file (spec 026 §0.2, §1, §5, §8):
 * the person page's frame once, then a `<section class="sp-page">` per page
 * of the set — the introduction (the hub of several lineages, the lineage,
 * the branch), the lineages, the families, the people and the index of
 * people — one <style> with the set's images, the search index as JSON and
 * the scripts once. Without the script every page shows under the other, the
 * contents of the file first; with it PAGE_SET_SCRIPT shows one at a time.
 *
 * The blocks are the book's (book-blocks.ts) and the person page's
 * (person-page.ts) in their set modes: links go to `#slug` in the file and
 * are `data-sp-open` buttons in the app's window (pageSetSectionHtml).
 */

import { Partnership, PartnershipId, Person, PersonId, StromData } from './types.js';
import { getStringsForLang, Language } from './strings.js';
import { formatFlexDate, yearOf } from './dates.js';
import { Rod, RodId, marriedInto, rodGenerations, rodNameForms, sortByBirth } from './lineage.js';
import { sortCoupleEvents } from './events.js';
import { shownNameOrEmpty, shownNameParts, shownSurnameIsBirth } from './person-name.js';
import { buildBookModel, BookModel } from './book-model.js';
import { BOOK_PART_KEYS, BookParts } from './book-options.js';
import {
    BookCtx, BookLinkTarget, BookSourceNumbers, bookName, bookYears, birthRodNamed, diedYoung, founderNote, branchPageLine,
    occupationOf, pageLineGenerationsHtml, pageLineHeadHtml, pageLinePeriod, pairFirstNames, rodLabelOf, rodLineageHtml, rodOverviewHtml,
    rodPageLine, roman,
} from './book-blocks.js';
import {
    PERSON_PAGE_ALL_GROUPS, PersonPageContext, PersonPageGroups, buildPersonPageBody, coupleChapterData, coupleChapterHtml,
    personPageDocumentShell, prefixPageIds, preparePersonPageData, PersonPageOptions, safeImage, shownExcerpt,
} from './person-page.js';
import {
    PageSet, PageSetIndexKind, SetPage, SetPlaceRow, familyFirstNames, familyTitle, isProtectedPerson, pageSetFileName, pageSetLivingNames,
    pageSetPlaces, pageSetSearchPeople, surnameFirst,
} from './family-pages.js';
import { FAMILY_PAGES_CSS, PAGE_SET_SCRIPT } from './family-pages-css.js';
import { pluralTemplates, searchPageSetIndex } from './family-pages-search.js';

export interface PageSetHtmlOptions {
    /** The embedded @font-face rules (the app supplies personPageFontCss()); none = fallback fonts. */
    fontCss?: string;
    /** The person pages' groups (default: all but the researchers' section, which never goes into a file). */
    groups?: Partial<PersonPageGroups>;
    /** What the app knows about a person besides the tree (history layer…); the protected tree is the set's. */
    personContext?: (id: PersonId) => Omit<PersonPageContext, 'protected'>;
}

type Strings = ReturnType<typeof getStringsForLang>;

interface Render {
    set: PageSet;
    mode: 'file' | 'app';
    S: Strings;
    model: BookModel;
    base: BookCtx;
    opts: PageSetHtmlOptions;
    /** The footer of the set's own pages (the person page writes its own). */
    foot: string;
    /** Members' generations per lineage, as asked for. */
    gens: Map<RodId, Map<PersonId, number>>;
    /** The index of places' rows, once asked for (the index and the lineages' headers). */
    places?: SetPlaceRow[];
}

function esc(text: string): string {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** The window's value of a page's link: `person:{id}`, `family:{id}`, `rod:{id}`, else `page:{slug}`. */
export function pageSetAppTarget(page: SetPage): string {
    if (page.kind === 'person' && page.id) return `person:${page.id}`;
    if (page.kind === 'family' && page.id) return `family:${page.id}`;
    if (page.kind === 'rod' && page.id) return `rod:${page.id}`;
    return `page:${page.slug}`;
}

/** The slug a reference of the blocks leads to ('' when the set has no page for it). */
function targetSlug(set: PageSet, target: BookLinkTarget): string {
    if ('person' in target) return set.personSlug.get(target.person) ?? '';
    if ('family' in target) return set.familySlug.get(target.family) ?? '';
    if ('rodId' in target) return set.rodSlug.get(target.rodId) ?? '';
    return '';
}

/** A link to a page of the set: `<a href="#slug">` in the file, a `data-sp-open` button in the window. */
function pageLink(r: Render, slug: string, html: string, cls = 'pp-link'): string {
    const page = r.set.bySlug.get(slug);
    if (!page) return html;
    return r.mode === 'file'
        ? `<a class="${cls}" href="#${esc(slug)}">${html}</a>`
        : `<button type="button" class="${cls}" data-sp-open="${esc(pageSetAppTarget(page))}">${html}</button>`;
}

function localDay(d: Date): string {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function makeRender(set: PageSet, mode: 'file' | 'app', opts: PageSetHtmlOptions): Render {
    const prot = set.protectedTree;
    const lang = set.options.lang;
    const S = getStringsForLang(lang);
    const model = buildBookModel(prot.lineages.data, set.spec, prot.lineages);
    const parts = Object.fromEntries(BOOK_PART_KEYS.map(k => [k, true])) as BookParts;
    const linkTo = (target: BookLinkTarget): string | null => {
        const slug = targetSlug(set, target);
        if (!slug) return null;
        return mode === 'file' ? `#${slug}` : pageSetAppTarget(set.bySlug.get(slug)!);
    };
    const base: BookCtx = {
        mode, lang, privacy: prot.privacy, detail: 'normal', parts, notes: false, research: false,
        linkTo, tree: prot.tree, living: prot.living, model, now: set.options.now,
        sources: new BookSourceNumbers(prot.tree.sources ?? {}, false),
        described: new Map(), protectedTree: prot,
    };
    const lines = [`<p>${esc(S.personPage.created(formatFlexDate(localDay(set.options.now), lang)))}</p>`];
    if (pageSetLivingNames(set).length) lines.push(`<p>${esc(S.familyPages.privacyNote[set.options.privacy])}</p>`);
    const r: Render = { set, mode, S, model, base, opts, foot: `<footer class="sp-foot">${lines.join('')}</footer>`, gens: new Map() };
    // A place of a lineage's header leads to its row of the index of places (§3.5; the map of places in step 6).
    base.placeLink = (key: string): string | null => {
        const slug = drawnSlug(r, set.indexSlug.places);
        if (!slug) return null;
        if (mode === 'app') return pageSetAppTarget(set.bySlug.get(slug)!);
        const i = placeRows(r).findIndex(p => p.key === key);
        return `#${i < 0 ? slug : placeAnchor(slug, i)}`;
    };
    return r;
}

/** §3.2: where the page stands; a phone shows only "‹ the page above". */
function crumbsHtml(r: Render, page: SetPage): string {
    const c = page.crumbs;
    if (c.length < 2) return '';
    const items = c.slice(0, -1).map(x => pageLink(r, x.slug, esc(x.label), 'sp-crumb'));
    const self = `<span aria-current="page">${esc(c[c.length - 1].label)}</span>`;
    const parts: string[] = [];
    items.forEach(it => { parts.push(it, '<span class="sp-sep" aria-hidden="true">›</span>'); });
    parts.push(self);
    const up = c[c.length - 2];
    const back = pageLink(r, up.slug, `‹ ${esc(up.label)}`, 'sp-crumb-back');
    return `<nav class="sp-crumbs" aria-label="${esc(r.S.familyPages.crumbs)}">${back}${parts.join('')}</nav>`;
}

function rodOf(r: Render, id: string | undefined): Rod | undefined {
    return id ? r.model.index.rods.get(id as Rod['id']) : undefined;
}

/** The pages a link of the bar, the menu or the teaser may lead to: an index or the map, when the file draws it. */
function drawnSlug(r: Render, slug: string): string {
    const page = slug ? r.set.bySlug.get(slug) : undefined;
    return page && rendered(page) ? slug : '';
}

/** "Index of this line" (§1.7): People · Families · Surnames · Places · Map of places. */
function teaserHtml(r: Render, branch: boolean): string {
    const F = r.S.familyPages;
    const links = (['persons', 'families', 'surnames', 'places'] as const)
        .map(k => [drawnSlug(r, r.set.indexSlug[k]), F.idxTabs[k]] as const)
        .concat([[drawnSlug(r, r.set.mapSlug), F.map] as const])
        .filter(([slug]) => !!slug)
        .map(([slug, label]) => pageLink(r, slug, esc(label), 'sp-btn'));
    if (!links.length) return '';
    return `<section class="sp-teaser"><h2 class="sp-teaser-h">${esc(branch ? F.idxTeaserBranch : F.idxTeaser)}</h2>`
        + `<div class="sp-btns">${links.join('')}</div></section>`;
}

function rodPageHtml(r: Render, page: SetPage, ctx: BookCtx): string {
    const rod = rodOf(r, page.id);
    if (!rod) return '';
    return `${rodOverviewHtml(rod, ctx, { title: page.title })}${rodLineageHtml(rod, ctx)}${teaserHtml(r, false)}`;
}

function branchPageHtml(r: Render, page: SetPage, ctx: BookCtx): string {
    const sel = r.set.selection;
    const line = branchPageLine(ctx, page.id as PersonId, sel.memberIds, sel.spouseIds, page.title);
    return `${pageLineHeadHtml(line, ctx)}${pageLineGenerationsHtml(line, ctx)}${teaserHtml(r, true)}`;
}

/** §1.5: the hub of several lineages — cards, then the marriages between them. */
function hubPageHtml(r: Render, page: SetPage, ctx: BookCtx): string {
    const { set, S } = r;
    const F = S.familyPages;
    const tree = set.protectedTree.tree;
    const persons = set.selection.personIds.filter(id => tree.persons[id] && !tree.persons[id].isPlaceholder).length;
    const sub = [F.nPersons(persons), F.nFams(set.selection.familyIds.length)].join(' · ');
    const nowYear = set.options.now.getFullYear();
    const lines = set.rodIds.map(id => rodOf(r, id)).filter((x): x is Rod => !!x).map(rod => {
        const slug = set.rodSlug.get(rod.id) ?? '';
        return { rod, slug, line: rodPageLine(rod, ctx, set.bySlug.get(slug)?.title) };
    });
    const periods = lines.map(l => pageLinePeriod(l.line, ctx));
    const lo = Math.min(1700, ...periods.filter(p => !!p).map(p => Math.floor(p!.from / 50) * 50));
    const span = Math.max(1, nowYear - lo);
    const cards = lines.map(({ rod, slug, line }, i) => {
        const period = periods[i];
        const founder = tree.persons[rod.founderId];
        const g = founder?.gender === 'female' ? 'f' : founder?.gender === 'male' ? 'm' : 'u';
        const founderLine = founder && !founder.isPlaceholder
            ? `${esc(F.founder[g])} ${bookName(ctx, rod.founderId)}${founderNote(ctx, rod.founderId)}` : '';
        const bar = period
            ? `<span class="sp-axis" aria-hidden="true"><span class="sp-bar" style="left:${((period.from - lo) / span * 100).toFixed(1)}%;width:${(Math.max(0.5, (period.to - period.from) / span * 100)).toFixed(1)}%"></span></span>`
            : '';
        const meta = [period ? `${period.from}–${period.to}` : '', F.nMembers(rod.realMemberCount), F.nFams(rod.familyIds.length)].filter(Boolean).join(' · ');
        const inner = `<span class="sp-card-t">${esc(line.title)}</span>${founderLine ? `<span class="sp-card-f">${founderLine}</span>` : ''}`
            + `${bar}<span class="sp-card-m">${esc(meta)}</span><span class="sp-card-go">${esc(F.openRod)}</span>`;
        return pageLink(r, slug, inner, 'sp-card');
    }).join('');
    // Marriages between the file's lineages: both partners members of two of them, neither protected.
    const index = set.protectedTree.lineages;
    const inSet = new Set(set.rodIds);
    const cross: string[] = [];
    for (const fid of set.selection.familyIds) {
        const u = tree.partnerships[fid];
        if (!u || !u.person1Id || !u.person2Id) continue;
        const ids = [u.person1Id, u.person2Id];
        if (ids.some(id => !tree.persons[id] || tree.persons[id].isPlaceholder || isProtectedPerson(set.protectedTree, id))) continue;
        const rods = ids.map(id => index.rodByPerson.get(id));
        if (!rods[0] || !rods[1] || rods[0] === rods[1] || !inSet.has(rods[0]) || !inSet.has(rods[1])) continue;
        const title = esc(familyTitle(tree, u, set.options.lang));
        const slug = set.familySlug.get(fid);
        const labels = rods.map(id => set.rodLabels.get(id!) || F.rodGeneric).join(' · ');
        cross.push(`<div class="sp-cross-row">${slug ? pageLink(r, slug, title) : title}<span class="sp-cross-rods">${esc(labels)}</span></div>`);
    }
    const crossHtml = cross.length ? `<section class="sp-cross"><h2 class="sp-h2">${esc(F.crossTitle)}</h2>${cross.join('')}</section>` : '';
    return `<header class="sp-head"><div class="sp-kicker">${esc(F.kHub)}</div><h1 class="sp-h1">${esc(page.title)}</h1><p class="sp-sub">${esc(sub)}</p></header>`
        + `<div class="sp-cards">${cards}</div>${crossHtml}`;
}

// ─── A family's page (§2.2) ─────────────────────────────────────────────────

function realIn(tree: StromData, id: PersonId | undefined | null): Person | undefined {
    const p = id ? tree.persons[id] : undefined;
    return p && !p.isPlaceholder ? p : undefined;
}

/** The couple, husband first (as the book's heading and the page's title). */
function coupleOf(tree: StromData, u: Partnership): Person[] {
    const ps = [u.person1Id, u.person2Id].map(id => realIn(tree, id)).filter((p): p is Person => !!p);
    return ps.sort((a, b) => (a.gender === 'female' ? 1 : 0) - (b.gender === 'female' ? 1 : 0));
}

function isWedding(u: Partnership): boolean {
    return u.status === 'married' || u.status === 'divorced';
}

function gKey(p: Person | undefined): 'm' | 'f' | 'u' {
    return p?.gender === 'male' ? 'm' : p?.gender === 'female' ? 'f' : 'u';
}

/** A member's generation within the lineage (I = its root), as the search index counts it. */
function generationOf(r: Render, id: PersonId): number | null {
    const rodId = r.model.index.rodByPerson.get(id);
    if (!rodId) return null;
    let gens = r.gens.get(rodId);
    if (!gens) {
        gens = new Map();
        rodGenerations(r.model.index, rodId).forEach((ids, i) => { for (const x of ids) gens!.set(x, i + 1); });
        r.gens.set(rodId, gens);
    }
    return gens.get(id) ?? null;
}

/** The lineage of the set a family belongs to (the first that lists it), else a partner's in the set. */
function familyRodId(r: Render, u: Partnership, ps: readonly Person[]): RodId | null {
    for (const id of r.set.rodIds) if (rodOf(r, id)?.familyIds.includes(u.id)) return id;
    const inSet = new Set(r.set.rodIds);
    for (const p of ps) {
        const rid = r.model.index.rodByPerson.get(p.id);
        if (rid && inSet.has(rid)) return rid;
    }
    const members = new Set(r.set.selection.memberIds);
    for (const p of ps) if (members.has(p.id)) return r.model.index.rodByPerson.get(p.id) ?? null;
    return null;
}

function rodLabel(r: Render, ctx: BookCtx, rodId: RodId): string {
    return r.set.rodLabels.get(rodId) || rodLabelOf(ctx, rodId) || r.S.familyPages.rodGeneric;
}

/** A link to a lineage's page of the set, plain text when it has none. */
function rodLinkHtml(r: Render, rodId: RodId, html: string): string {
    const slug = r.set.rodSlug.get(rodId);
    return slug ? pageLink(r, slug, html) : html;
}

function personLinkHtml(r: Render, ctx: BookCtx, id: PersonId): string {
    const name = bookName(ctx, id);
    if (isProtectedPerson(r.set.protectedTree, id)) return name;
    const slug = r.set.personSlug.get(id);
    return slug ? pageLink(r, slug, name) : name;
}

function familyLinkHtml(r: Render, uid: PartnershipId, html: string): string {
    const slug = r.set.familySlug.get(uid);
    return slug ? pageLink(r, slug, html) : html;
}

/** The union a person was born into (the first one recorded with the person among its children). */
function parentUnionOf(tree: StromData, p: Person): Partnership | undefined {
    for (const par of p.parentIds ?? []) {
        for (const uid of tree.persons[par]?.partnerships ?? []) {
            const u = tree.partnerships[uid];
            if (u?.childIds.includes(p.id)) return u;
        }
    }
    return undefined;
}

/** A person's unions with both partners recorded, by date (undated last, as recorded). */
function datedUnions(tree: StromData, p: Person): Partnership[] {
    const list = p.partnerships.map(id => tree.partnerships[id]).filter((u): u is Partnership => !!u && coupleOf(tree, u).length === 2);
    return list.map((u, i) => ({ u, i, y: yearOf(u.startDate) ?? Infinity })).sort((a, b) => a.y - b.y || a.i - b.i).map(x => x.u);
}

function dateAndPlace(r: Render, date: string | undefined, place: string | undefined): string {
    return [date ? formatFlexDate(date, r.set.options.lang) : '', place?.trim() ?? ''].filter(Boolean).join(', ');
}

/** The note after a married-in name: "née Kvapilová" ('' when the shown surname is the birth one). */
function birthSurnameNote(r: Render, p: Person): string {
    const birth = p.lastName?.trim() ?? '';
    const parts = shownNameParts(p);
    if (!birth || !p.marriedSurname?.trim() || shownSurnameIsBirth(p) || parts.surname.trim() === birth) return '';
    return `${r.S.name.birthAbbr} ${birth}`;
}

/** A portrait 64×80: the set's image in the file, an <img> in the window ('' without one). */
function portraitHtml(r: Render, p: Person): string {
    const src = r.set.options.photos === 'none' ? null : safeImage(p.photo);
    if (!src) return '';
    if (r.mode === 'file') {
        const cls = r.set.images.add(src, 'photo');
        return cls ? `<span class="pp-img sp-portrait ${cls}" aria-hidden="true"></span>` : '';
    }
    return `<img class="sp-portrait" src="${esc(src)}" alt="" loading="lazy">`;
}

function partnerCardHtml(r: Render, ctx: BookCtx, u: Partnership, p: Person, famRod: RodId | null): string {
    const F = r.S.familyPages;
    const P = F.fam;
    const prot = isProtectedPerson(r.set.protectedTree, p.id);
    const husband = p.gender !== 'female';
    const role = isWedding(u) ? (husband ? P.husband : P.wife) : (p.gender === 'female' ? P.mother : p.gender === 'male' ? P.father : P.partner);
    const yrs = bookYears(p);
    const facts: string[] = [];
    const fact = (k: string, v: string): void => { if (v) facts.push(`<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`); };
    if (!prot) {
        fact(P.born, dateAndPlace(r, p.birthDate, p.birthPlace));
        fact(P.died, dateAndPlace(r, p.deathDate, p.deathPlace));
        fact(P.occupation, occupationOf(p));
        const note = birthSurnameNote(r, p);
        if (note) facts.push(`<dt></dt><dd>${esc(note)}</dd>`);
    }
    const rows: string[] = [];
    const rodId = r.model.index.rodByPerson.get(p.id) ?? null;
    if (!prot && rodId) {
        const inSet = r.set.rodIds.includes(rodId);
        const gen = generationOf(r, p.id);
        if ((rodId === famRod || inSet) && gen !== null) {
            rows.push(rodLinkHtml(r, rodId, esc(F.tagRod(rodLabel(r, ctx, rodId), roman(gen)))));
        } else if (birthRodNamed(ctx, p.id)) {
            rows.push(rodLinkHtml(r, rodId, esc(F.birthRod(rodLabel(r, ctx, rodId)))));
        }
    }
    const parents = prot ? undefined : parentUnionOf(r.set.protectedTree.tree, p);
    if (parents && coupleOf(r.set.protectedTree.tree, parents).length) {
        rows.push(`↑ ${esc(P.parentsFam)}: ${familyLinkHtml(r, parents.id, pairFirstNames(ctx, parents))}`);
    }
    const slug = prot ? '' : r.set.personSlug.get(p.id) ?? '';
    const go = slug ? pageLink(r, slug, esc(P.personPage), 'sp-go') : '';
    const portrait = prot ? '' : portraitHtml(r, p);
    return `<div class="sp-partner">`
        + `<div class="sp-partner-top">${portrait}<div class="sp-partner-id"><span class="sp-role">${esc(role)}</span>`
        + `<span class="sp-partner-name">${personLinkHtml(r, ctx, p.id)}</span>${yrs ? `<span class="sp-yrs">${esc(yrs)}</span>` : ''}</div></div>`
        + (facts.length ? `<dl class="sp-pfacts">${facts.join('')}</dl>` : '')
        + rows.map(x => `<span class="sp-prow">${x}</span>`).join('')
        + go + '</div>';
}

/** "Josef Fíšek · 2nd marriage: ⚭ 1876 Terezie Lhotáková" — the partners' other unions that have pages. */
function otherMarriagesHtml(r: Render, ctx: BookCtx, u: Partnership, ps: readonly Person[]): string {
    const tree = r.set.protectedTree.tree;
    const F = r.S.familyPages;
    const out: string[] = [];
    for (const p of ps) {
        const all = datedUnions(tree, p);
        if (all.length < 2) continue;
        all.forEach((o, k) => {
            if (o.id === u.id || !r.set.familySlug.has(o.id)) return;
            const other = coupleOf(tree, o).find(x => x.id !== p.id);
            const y = isWedding(o) ? yearOf(o.startDate) : null;
            const label = `${y !== null ? `⚭ ${y} ` : ''}${other ? bookName(ctx, other.id) : '?'}`;
            out.push(`<div class="sp-other"><span class="sp-other-pre">${bookName(ctx, p.id)} · ${esc(F.nth(k + 1))}:</span>${familyLinkHtml(r, o.id, label)}</div>`);
        });
    }
    return out.join('');
}

/** The marriage's record excerpt: the first of the union's sources (the set's image and its zoom in the file). */
function marriageClip(r: Render, u: Partnership): { src: string; caption: string } | null {
    const sources = r.set.protectedTree.tree.sources ?? {};
    for (const sid of u.sourceIds ?? []) {
        const s = sources[sid];
        for (const e of s?.excerpts ?? []) {
            const src = shownExcerpt(e);
            if (src) return { src, caption: [s.title?.trim(), s.reference?.trim()].filter(Boolean).join(', ') };
        }
    }
    return null;
}

function marriageHtml(r: Render, ctx: BookCtx, u: Partnership, slug: string): string {
    const P = r.S.familyPages.fam;
    const tree = r.set.protectedTree.tree;
    const facts: string[] = [];
    const fact = (k: string, v: string): void => { if (v) facts.push(`<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`); };
    if (isWedding(u)) {
        fact(P.date, u.startDate ? formatFlexDate(u.startDate, r.set.options.lang) : '');
        fact(P.place, [u.startPlace?.trim(), u.address?.trim()].filter(Boolean).join(', '));
        const witnesses = (u.participants ?? []).filter(x => x.role === 'witness').map(x => {
            const linked = x.personId ? realIn(tree, x.personId) : undefined;
            const who = linked ? shownNameOrEmpty(linked) : (x.name ?? '').trim();
            return who ? (x.note?.trim() ? `${who}, ${x.note.trim()}` : who) : '';
        }).filter(Boolean);
        fact(P.witnesses, witnesses.join('; '));
    }
    const clip = r.set.options.clips === 'none' ? null : marriageClip(r, u);
    let clipHtml = '';
    let lightbox = '';
    if (clip) {
        const cap = clip.caption ? `<span class="sp-clip-cap">${esc(clip.caption)}</span>` : '';
        if (r.mode === 'file') {
            const cls = r.set.images.add(clip.src, 'clip');
            if (cls) {
                const lb = `${slug}--obr-1`;
                clipHtml = `<a class="sp-clip" href="#${esc(lb)}" aria-label="${esc(P.clip)}"><span class="pp-img sp-clip-img ${cls}" role="img" aria-label="${esc(clip.caption || P.clip)}"></span>${cap}</a>`;
                lightbox = `<div class="pp-lb" id="${esc(lb)}" role="dialog" aria-label="${esc(clip.caption || P.clip)}">`
                    + `<div class="pp-lb-top"><span class="pp-lb-count"></span><a class="pp-lb-close" href="#${esc(slug)}--sp-marriage" data-pp-lb="close">${esc(r.S.personPage.gal.closeZoom)}</a></div>`
                    + `<span class="pp-img pp-lb-img ${cls}" role="img" aria-label="${esc(clip.caption || P.clip)}"></span>`
                    + `<div class="pp-lb-foot"><span class="pp-lb-cap">${esc(clip.caption)}</span></div></div>`;
            }
        } else {
            clipHtml = `<div class="sp-clip"><img class="sp-clip-img" src="${esc(clip.src)}" alt="${esc(clip.caption || P.clip)}" loading="lazy">${cap}</div>`;
        }
    }
    if (!facts.length && !clipHtml) return '';
    return `<section class="sp-block sp-marriage" id="${esc(slug)}--sp-marriage"><h2 class="sp-h2">${esc(P.marriage)}</h2>`
        + `<div class="sp-mar">${facts.length ? `<dl class="sp-mfacts">${facts.join('')}</dl>` : ''}${clipHtml}</div>${lightbox}</section>`;
}

function residenceHtml(r: Render, u: Partnership): string {
    const rows = sortCoupleEvents(u.events ?? []).filter(e => e.type === 'residence').map(e => {
        const where = [e.place?.trim(), e.address?.trim()].filter(Boolean).join(' ');
        const when = e.date ? formatFlexDate(e.date, r.set.options.lang) : '';
        return [where, when].filter(Boolean).join(' · ');
    }).filter(Boolean);
    if (!rows.length) return '';
    return `<section class="sp-block"><h2 class="sp-h2">${esc(r.S.familyPages.fam.residence)}</h2>${rows.map(x => `<p class="sp-res">${esc(x)}</p>`).join('')}</section>`;
}

function childCardHtml(r: Render, ctx: BookCtx, c: Person): string {
    const F = r.S.familyPages;
    const tree = r.set.protectedTree.tree;
    const prot = isProtectedPerson(r.set.protectedTree, c.id);
    const young = diedYoung(c);
    let note = '';
    if (young) note = esc(F.diedChild[gKey(c)]);
    else if (!prot) {
        const first = datedUnions(tree, c)[0];
        const into = marriedInto(r.model.index, c.id)[0];
        if (first && r.set.familySlug.has(first.id)) {
            note = familyLinkHtml(r, first.id, `→ ${esc(F.familyRef(familyFirstNames(tree, first, r.set.options.lang)))}`);
        } else if (into) {
            note = rodLinkHtml(r, into.rodId, esc(F.toRod(rodLabel(r, ctx, into.rodId))));
        } else if (!c.partnerships.length && !r.set.protectedTree.living.has(c.id) && (yearOf(c.deathDate) !== null)) {
            note = esc(F.fam.single[gKey(c)]);
        }
    }
    const yrs = bookYears(c);
    return `<div class="sp-kid${young ? ' sp-kid--young' : ''}"><span class="sp-kid-name">${personLinkHtml(r, ctx, c.id)}</span>`
        + (yrs ? `<span class="sp-yrs">${esc(yrs)}</span>` : '')
        + (note ? `<span class="sp-kid-note">${note}</span>` : '') + '</div>';
}

/** The union's sources (its own and its events'), as the book lists a chapter's. */
function familySourcesHtml(r: Render, u: Partnership): string {
    if (!r.set.options.sources) return '';
    const sources = r.set.protectedTree.tree.sources ?? {};
    const ids = [...new Set([...(u.sourceIds ?? []), ...(u.events ?? []).flatMap(e => e.sourceIds ?? [])])].filter(id => !!sources[id]);
    const rows = ids.map(id => {
        const s = sources[id];
        return [s.title, s.reference].filter(x => !!x?.trim()).map(x => esc(x!.trim())).join(', ');
    }).filter(Boolean);
    if (!rows.length) return '';
    return `<section class="sp-block"><h2 class="sp-h2">${esc(r.S.familyPages.fam.sources)}</h2>${rows.map(x => `<p class="sp-src">${x}</p>`).join('')}</section>`;
}

function familyStoryHtml(r: Render, u: Partnership, ps: readonly Person[], slug: string): string {
    if (!r.set.options.stories || !ps.length) return '';
    const tree = r.set.protectedTree.tree;
    const ch = coupleChapterData(tree, ps[0], u, r.set.options.lang);
    if (!ch) return '';
    const html = coupleChapterHtml(ch, { lang: r.set.options.lang, mode: r.mode, foldable: false, open: true, partnerHtml: '', tint: false });
    return `<section class="sp-block sp-story"><h2 class="sp-h2">${esc(r.S.familyPages.fam.story)}</h2>${prefixPageIds(html, slug)}</section>`;
}

/** A family's page (§2.2): the couple, the partners' cards, the marriage, the home, the children, the story, the sources. */
function familyPageHtml(r: Render, page: SetPage, ctx: BookCtx): string {
    const F = r.S.familyPages;
    const tree = r.set.protectedTree.tree;
    const u: Partnership | undefined = page.id ? tree.partnerships[page.id as PartnershipId] : undefined;
    if (!u) return '';
    const ps = coupleOf(tree, u);
    const wedding = isWedding(u);
    const famRod = familyRodId(r, u, ps);
    const member = ps.find(p => famRod && r.model.index.rodByPerson.get(p.id) === famRod) ?? ps[0];
    const gen = member ? generationOf(r, member.id) : null;
    const kicker = famRod ? F.famKicker(rodLabel(r, ctx, famRod), roman(gen ?? 1)) : F.kFam;
    const sym = wedding ? ' <span class="sp-sym">⚭</span> ' : ` ${esc(r.S.book.and)} `;
    const h1 = ps.map(p => bookName(ctx, p.id)).join(sym) || esc(page.title);
    const kids = sortByBirth(tree, [...(u.childIds ?? [])]).map(id => realIn(tree, id)).filter((c): c is Person => !!c);
    const mar = wedding ? `⚭${dateAndPlace(r, u.startDate, u.startPlace) ? ` ${dateAndPlace(r, u.startDate, u.startPlace)}` : ''}` : F.notMarried;
    const sub = [mar, kids.length ? F.nKids(kids.length) : F.noKids].join(' · ');
    const head = `<header class="sp-head"><div class="sp-kicker">${esc(kicker)}</div><h1 class="sp-h1">${h1}</h1>`
        + `<p class="sp-sub">${esc(sub)}</p>${otherMarriagesHtml(r, ctx, u, ps)}</header>`;
    const partners = `<div class="sp-partners">${ps.map(p => partnerCardHtml(r, ctx, u, p, famRod)).join('')}</div>`;
    const children = kids.length
        ? `<section class="sp-block"><h2 class="sp-h2">${esc(F.fam.kidsOf(kids.length))}</h2><div class="sp-kids-grid">${kids.map(c => childCardHtml(r, ctx, c)).join('')}</div></section>`
        : '';
    return `<div class="sp-fam-page">${head}${partners}${marriageHtml(r, ctx, u, page.slug)}${residenceHtml(r, u)}${children}`
        + `${familyStoryHtml(r, u, ps, page.slug)}${familySourcesHtml(r, u)}</div>`;
}

// ─── The bar and the search (§3.1, §3.4) ───────────────────────────────────

/** Which item of the bar a page lights up. */
function barCurrent(page: SetPage | null): 'index' | 'map' | '' {
    return page?.kind === 'index' ? 'index' : page?.kind === 'map' ? 'map' : '';
}

/**
 * The file's bar (§3.1): the file's name (the introduction), the search
 * field, Index and Map of places (the map only when the file draws it); on a
 * phone the name, the magnifier that turns the bar into the field with
 * Cancel, and Menu with its panel under the bar. One bar for the file (the
 * script marks the current item), one per page in the window (`page`).
 */
function barHtml(r: Render, page: SetPage | null): string {
    const { set, S } = r;
    const F = S.familyPages;
    const intro = set.bySlug.get(set.introSlug);
    const cur = barCurrent(page);
    const mark = (html: string, on: boolean): string => on ? html.replace(/^<(a|button) /, '<$1 aria-current="page" ') : html;
    const navLink = (slug: string, label: string, kind: 'index' | 'map'): string =>
        slug ? mark(pageLink(r, slug, esc(label), 'sp-fbar-a').replace(/^<(a|button) /, `<$1 data-sp-nav="${kind}" `), cur === kind) : '';
    const idx = drawnSlug(r, set.indexSlug.persons);
    const map = drawnSlug(r, set.mapSlug);
    const home = intro ? pageLink(r, intro.slug, esc(intro.title), 'sp-fbar-home') : '';
    const menuItems: [string, string][] = [
        [set.introSlug, F.start],
        ...(['persons', 'families', 'surnames', 'places'] as const).map(k => [drawnSlug(r, set.indexSlug[k]), F.idxTabs[k]] as [string, string]),
        [map, F.map],
    ];
    const menu = menuItems.filter(([slug]) => !!slug)
        .map(([slug, label]) => mark(pageLink(r, slug, esc(label), 'sp-menu-a'), page?.slug === slug)).join('');
    return `<div class="sp-fbar"><div class="sp-fbar-in">${home}<span class="sp-fbar-gap"></span>`
        + `<label class="sp-search"><span class="sp-ico" aria-hidden="true"></span>`
        + `<input class="sp-q" type="search" placeholder="${esc(F.searchPh)}" aria-label="${esc(F.searchLabel)}" autocomplete="off" spellcheck="false" enterkeyhint="search"></label>`
        + `<button type="button" class="sp-fbar-cancel">${esc(F.searchCancel)}</button>`
        + `<nav class="sp-fbar-nav" aria-label="${esc(F.navLabel)}">${navLink(idx, F.index, 'index')}${navLink(map, F.map, 'map')}</nav>`
        + `<button type="button" class="sp-fbar-lupa" aria-label="${esc(F.searchOpen)}"><span class="sp-ico" aria-hidden="true"></span></button>`
        + `<button type="button" class="sp-fbar-menu" aria-expanded="false" aria-controls="sp-menu">${esc(F.menu)}</button>`
        + `</div><nav class="sp-menu" id="sp-menu" aria-label="${esc(F.menu)}" hidden>${menu}</nav></div>`;
}

/** The texts of the search for the file's script (counts per plural category, "{n}" and "{q}" to fill in). */
function searchStrings(r: Render): Record<string, unknown> {
    const { set, S } = r;
    const F = S.familyPages;
    const lang = set.options.lang;
    const hint = [F.searchHint(set.searchIndex.length), pageSetLivingNames(set).length && set.options.privacy !== 'full' ? F.searchHintLiving : '']
        .filter(Boolean).join(' ');
    return {
        res: pluralTemplates(lang, n => F.searchResults(n, '{q}')),
        more: pluralTemplates(lang, n => F.searchMore(n)),
        none: F.none('{q}'), hint, toIdx: F.toIdx, idx: drawnSlug(r, set.indexSlug.persons),
    };
}

function jsonForScript(value: unknown): string {
    return JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');
}

/**
 * The search's results (§3.4) as the file's script draws them: the count,
 * up to ten people (the name leading to the page, the protected as text,
 * the years, the tag), "N more in the index →"; nothing found: why, and the
 * index of people. '' for an empty query.
 */
export function pageSetSearchHtml(set: PageSet, query: string, opts: PageSetHtmlOptions & { mode?: 'file' | 'app' } = {}): string {
    const r = makeRender(set, opts.mode ?? 'app', opts);
    const q = query.trim();
    if (!q) return '';
    const F = r.S.familyPages;
    const t = searchStrings(r) as { hint: string; idx: string };
    const res = searchPageSetIndex(set.searchIndex, q, set.options.lang);
    const toIndex = (html: string): string => t.idx ? pageLink(r, t.idx, html) : html;
    if (!res.total) {
        return `<div class="sp-res-none"><p class="sp-res-none-t">${esc(F.none(q))}</p><p class="sp-res-hint">${esc(t.hint)}</p>`
            + `<p>${toIndex(esc(F.toIdx))}</p></div>`;
    }
    const rows = res.hits.map(e => `<li class="sp-res-row">${e.s && set.bySlug.has(e.s) ? pageLink(r, e.s, esc(e.n), 'pp-link sp-res-n') : `<span class="sp-res-n">${esc(e.n)}</span>`}`
        + `${e.y ? ` <span class="sp-res-y">${esc(e.y)}</span>` : ''}${e.t ? ` <span class="sp-res-t">${esc(e.t)}</span>` : ''}</li>`).join('');
    const more = res.total > res.hits.length ? `<p class="sp-res-more">${toIndex(esc(F.searchMore(res.total - res.hits.length)))}</p>` : '';
    return `<p class="sp-res-head">${esc(F.searchResults(res.total, q))}</p><ul class="sp-res-list">${rows}</ul>${more}`;
}

/** The bar of a page in the app's window (§3.3): the file's bar, its links `data-sp-open` buttons. */
export function pageSetBarHtml(set: PageSet, slug: string, opts: PageSetHtmlOptions = {}): string {
    return barHtml(makeRender(set, 'app', opts), set.bySlug.get(slug) ?? null);
}

// ─── The indexes (§3.5) ─────────────────────────────────────────────────────

/**
 * The letter an index groups a name under: Czech "Ch" is a letter of its own
 * (after H); a letter the language does not tell from its base letter goes
 * with it (Á with A in Czech, Ä with A in German), one that it does stays
 * apart (Č, Ř, Š in Czech).
 */
export function indexLetter(text: string, lang: Language): string {
    const t = text.trim();
    if (!t) return '';
    if (lang === 'cs' && /^ch/i.test(t)) return 'Ch';
    const ch = Array.from(t)[0].toLocaleUpperCase(lang);
    const base = ch.normalize('NFD').replace(/\p{M}/gu, '');
    return base && base !== ch && new Intl.Collator(lang, { sensitivity: 'base' }).compare(ch, base) === 0 ? base : ch;
}

function placeRows(r: Render): SetPlaceRow[] {
    if (!r.places) r.places = pageSetPlaces(r.set);
    return r.places;
}

/** The anchor of a place's row in the index of places. */
function placeAnchor(slug: string, i: number): string {
    return `${slug}--o-${i + 1}`;
}

/** A person's name leading to the page; the protected and those without a page as text. */
function personNameLink(r: Render, id: PersonId, html: string, cls = 'pp-link'): string {
    if (isProtectedPerson(r.set.protectedTree, id)) return html;
    const slug = r.set.personSlug.get(id);
    return slug ? pageLink(r, slug, html, cls) : html;
}

function emptyIndex(r: Render): string {
    return `<p class="sp-ix-empty">${esc(r.S.familyPages.idxEmpty)}</p>`;
}

/** People: "Surname, Given · years · tag" by initial letter, the letters above filter (anchors without the script). */
function personsIndexHtml(r: Render, slug: string): string {
    const { set, S } = r;
    const F = S.familyPages;
    const lang = set.options.lang;
    const tree = set.protectedTree.tree;
    const ids = pageSetSearchPeople(set);
    const items = ids.map((id, i) => {
        const e = set.searchIndex[i];
        const parts = shownNameParts(tree.persons[id]!);
        const sur = parts.surname.trim();
        const giv = parts.given.trim();
        const prot = isProtectedPerson(set.protectedTree, id);
        const shown = prot ? e.n : sur && giv ? `${sur}, ${giv}` : sur || giv || e.n;
        return { id, e, shown, sort: `${sur ? '0' : '1'} ${e.o}`, letter: indexLetter(sur, lang) };
    }).sort((a, b) => a.sort.localeCompare(b.sort, lang) || a.e.y.localeCompare(b.e.y));
    if (!items.length) return emptyIndex(r);
    const groups = new Map<string, typeof items>();
    for (const it of items) {
        const g = groups.get(it.letter);
        if (g) g.push(it); else groups.set(it.letter, [it]);
    }
    const keys = [...groups.keys()];
    const label = (k: string): string => k || S.book.noSurname;
    const letter = (key: string, n: number | null, text: string): string => {
        const cur = n === null ? ' aria-current="true"' : '';
        const val = n === null ? '' : String(n);
        return r.mode === 'file'
            ? `<a class="sp-letter" href="#${esc(n === null ? slug : `${slug}--pis-${n}`)}" data-sp-letter="${val}"${cur}>${esc(text)}</a>`
            : `<button type="button" class="sp-letter" data-sp-letter="${val}"${cur}>${esc(text)}</button>`;
    };
    const letters = `<nav class="sp-letters" aria-label="${esc(F.idxLetters)}">${letter(slug, null, F.idxAll)}`
        + `${keys.map((k, i) => letter(slug, i + 1, label(k))).join('')}</nav>`;
    const body = keys.map((k, i) => {
        const rows = groups.get(k)!.map(it => `<li class="sp-ix-row">${personNameLink(r, it.id, esc(it.shown), 'pp-link sp-ix-n')}`
            + `${it.e.y ? ` <span class="sp-ix-y">${esc(it.e.y)}</span>` : ''}${it.e.t ? ` <span class="sp-ix-t">${esc(it.e.t)}</span>` : ''}</li>`).join('');
        return `<div class="sp-ix-group" id="${esc(`${slug}--pis-${i + 1}`)}" data-sp-group="${i + 1}"><h2 class="sp-ix-letter">${esc(label(k))}</h2>`
            + `<ul class="sp-ix-list">${rows}</ul></div>`;
    }).join('');
    return letters + body;
}

/** Families with a page: "Josef Fíšek ⚭ Anna Kvapilová · 1846 · 7 children". */
function familiesIndexHtml(r: Render): string {
    const { set, S } = r;
    const F = S.familyPages;
    const lang = set.options.lang;
    const tree = set.protectedTree.tree;
    const fams = set.selection.familyIds.filter(fid => set.familySlug.has(fid) && tree.partnerships[fid]).map(fid => {
        const u = tree.partnerships[fid];
        const ps = coupleOf(tree, u);
        return { u, ps, sort: ps.map(p => surnameFirst(p)).join(' '), year: isWedding(u) ? yearOf(u.startDate) : null };
    }).sort((a, b) => a.sort.localeCompare(b.sort, lang) || (a.year ?? 9999) - (b.year ?? 9999));
    if (!fams.length) return emptyIndex(r);
    const rows = fams.map(({ u, ps, year }) => {
        const names = ps.map(p => esc(shownNameOrEmpty(p) || '?')).join(year !== null || isWedding(u) ? ' ⚭ ' : ` ${esc(S.book.and)} `);
        const kids = (u.childIds ?? []).filter(id => realIn(tree, id)).length;
        return `<li class="sp-ix-row">${pageLink(r, set.familySlug.get(u.id)!, names, 'pp-link sp-ix-n')}`
            + `${year !== null ? ` <span class="sp-ix-y">${year}</span>` : ''} <span class="sp-ix-t">${esc(kids ? F.nKids(kids) : F.noKids)}</span></li>`;
    }).join('');
    return `<ul class="sp-ix-list">${rows}</ul>`;
}

/** A row that unfolds the people it stands for (open without the script). */
function foldRowHtml(r: Render, id: string, head: string, people: readonly PersonId[]): string {
    const tree = r.set.protectedTree.tree;
    const sub = people.map(pid => {
        const p = tree.persons[pid];
        const y = p ? bookYears(p) : '';
        return `<li>${personNameLink(r, pid, esc(p ? shownNameOrEmpty(p) || '?' : '?'))}${y ? ` <span class="sp-ix-y">${esc(y)}</span>` : ''}</li>`;
    }).join('');
    return `<details class="sp-ix-more"${id ? ` id="${esc(id)}"` : ''} open><summary class="sp-ix-sum">${head}</summary><ul class="sp-ix-sub">${sub}</ul></details>`;
}

/** Surnames: a row per lineage with its forms, then the birth surnames of those who married in. */
function surnamesIndexHtml(r: Render): string {
    const { set, S } = r;
    const F = S.familyPages;
    const lang = set.options.lang;
    const tree = set.protectedTree.tree;
    const inSel = new Set(set.selection.personIds);
    const rodRows = set.rodIds.map(rid => {
        const rod = rodOf(r, rid);
        if (!rod) return '';
        const label = set.rodLabels.get(rid) ?? '';
        const n = rod.memberIds.filter(id => inSel.has(id) && realIn(tree, id)).length;
        if (!n) return '';
        const nf = label ? rodNameForms(rod, tree) : { forms: [], feminine: [] };
        const forms = nf.forms.length ? nf.forms.join(' · ') : label || F.rodGeneric;
        const fem = nf.feminine.length ? ` <span class="sp-ix-y">${esc(F.feminine(nf.feminine.join(', ')))}</span>` : '';
        return `<li class="sp-ix-row">${rodLinkHtml(r, rid, `<span class="sp-ix-n">${esc(forms)}</span>`)}${fem}`
            + ` <span class="sp-ix-t">${esc(`${F.rodRef(label || F.rodGeneric)} · ${F.nPersons(n)}`)}</span></li>`;
    }).filter(Boolean);
    const bySurname = new Map<string, PersonId[]>();
    for (const id of set.selection.spouseIds) {
        const p = realIn(tree, id);
        if (!p || isProtectedPerson(set.protectedTree, id)) continue;
        const last = p.lastName?.trim();
        if (!last) continue;
        const list = bySurname.get(last);
        if (list) list.push(id); else bySurname.set(last, [id]);
    }
    const birth = [...bySurname.entries()].sort((a, b) => a[0].localeCompare(b[0], lang)).map(([last, ids]) =>
        foldRowHtml(r, '', `<span class="sp-ix-n">${esc(last)}</span> <span class="sp-ix-y">${esc(F.nPersons(ids.length))}</span>`, sortByBirth(tree, ids)));
    if (!rodRows.length && !birth.length) return emptyIndex(r);
    return `${rodRows.length ? `<ul class="sp-ix-list">${rodRows.join('')}</ul>` : ''}`
        + `${birth.length ? `<h2 class="sp-ix-h2">${esc(F.birthSurnames)}</h2><div class="sp-ix-folds">${birth.join('')}</div>` : ''}`;
}

/** Places: "Čapkov · 1702–2010 · 37 people", unfolding who had a record there (the protected left out). */
function placesIndexHtml(r: Render, slug: string): string {
    const F = r.S.familyPages;
    const rows = placeRows(r);
    if (!rows.length) return emptyIndex(r);
    return `<div class="sp-ix-folds">${rows.map((p, i) => foldRowHtml(r, placeAnchor(slug, i),
        `<span class="sp-ix-n">${esc(p.name)}</span> <span class="sp-ix-dot" aria-hidden="true">·</span> <span class="sp-ix-y">${p.from === p.to ? p.from : `${p.from}–${p.to}`}</span>`
        + ` <span class="sp-ix-dot" aria-hidden="true">·</span> <span class="sp-ix-t">${esc(F.nPersons(p.personIds.length))}</span>`, p.personIds)).join('')}</div>`;
}

/** One index (§3.5): "Index", the four tabs, its rows. */
function indexPageHtml(r: Render, page: SetPage): string {
    const F = r.S.familyPages;
    const kind = page.id as PageSetIndexKind;
    const tabs = (['persons', 'families', 'surnames', 'places'] as const).map(k => {
        const slug = drawnSlug(r, r.set.indexSlug[k]);
        if (!slug) return '';
        return k === kind ? `<span class="sp-tab" aria-current="page">${esc(F.idxTabs[k])}</span>` : pageLink(r, slug, esc(F.idxTabs[k]), 'sp-tab');
    }).join('');
    let body = '';
    if (kind === 'persons') body = personsIndexHtml(r, page.slug);
    else if (kind === 'families') body = familiesIndexHtml(r);
    else if (kind === 'surnames') body = surnamesIndexHtml(r);
    else body = placesIndexHtml(r, page.slug);
    return `<header class="sp-head"><h1 class="sp-h1">${esc(F.index)}</h1></header>`
        + `<nav class="sp-tabs" aria-label="${esc(F.idxNav)}">${tabs}</nav><div class="sp-ix sp-ix--${kind}">${body}</div>`;
}

/** The pages this step draws: every page but the map and the whole tree (not yet). */
function rendered(page: SetPage): boolean {
    return page.kind !== 'map' && page.kind !== 'tree';
}

/** The pages of the file, in its order (those drawn so far). */
export function pageSetRenderedPages(set: PageSet): SetPage[] {
    return set.pages.filter(rendered);
}

function personPageOpts(r: Render, page: SetPage): PersonPageOptions {
    const set = r.set;
    return {
        personId: page.id as PersonId, lang: set.options.lang, mode: r.mode,
        groups: { ...PERSON_PAGE_ALL_GROUPS, research: false, sources: set.options.sources, ...(r.opts.groups ?? {}) },
        privacy: set.options.privacy, toggles: { history: true, childEvents: true }, research: false,
        now: set.options.now, toc: false,
        links: { mode: 'set', personSlug: set.personSlug, familySlug: set.familySlug, rodSlug: set.rodSlug },
        idPrefix: page.slug,
        ...(r.mode === 'file' ? { images: set.images } : {}),
    };
}

/** One page's content inside its section (the breadcrumbs, the blocks, the footer). */
function pageInnerHtml(r: Render, page: SetPage): string {
    const crumbs = crumbsHtml(r, page);
    if (page.kind === 'person') {
        const o = personPageOpts(r, page);
        const ctx = { ...(r.opts.personContext?.(o.personId) ?? {}), protected: r.set.protectedTree };
        const data = r.set.protectedTree.lineages.data;
        return `${crumbs}${buildPersonPageBody(preparePersonPageData(data, o, ctx), o)}`;
    }
    const ctx: BookCtx = { ...r.base, idPrefix: page.slug };
    let body = '';
    if (page.kind === 'rod') body = rodPageHtml(r, page, ctx);
    else if (page.kind === 'branch') body = branchPageHtml(r, page, ctx);
    else if (page.kind === 'hub') body = hubPageHtml(r, page, ctx);
    else if (page.kind === 'family') body = familyPageHtml(r, page, ctx);
    else if (page.kind === 'index') body = indexPageHtml(r, page);
    return `${crumbs}<div class="sp-body">${body}</div>${r.foot}`;
}

function sectionHtml(r: Render, page: SetPage): string {
    const intro = page.slug === r.set.introSlug ? ' data-sp-intro' : '';
    return `<section class="sp-page sp-page--${page.kind}" id="${esc(page.slug)}" data-sp-title="${esc(page.title)}"${intro}>`
        + `${pageInnerHtml(r, page)}</section>`;
}

/** §0.2: the contents of the file, first without the script (3i). */
function fileTocHtml(r: Render, pages: readonly SetPage[]): string {
    const F = r.S.familyPages;
    const rows: string[] = [];
    const row = (label: string, list: SetPage[]): void => {
        if (!list.length) return;
        rows.push(`<div class="sp-toc-row"><span>${esc(label)}</span><span>${list.map(p => pageLink(r, p.slug, esc(p.title), 'sp-toc-a')).join(', ')}</span></div>`);
    };
    const intro = pages.filter(p => p.slug === r.set.introSlug);
    row(F.tocIntro, intro);
    row(F.tocRods, pages.filter(p => p.kind === 'rod' && p.slug !== r.set.introSlug));
    row(F.tocFams, pages.filter(p => p.kind === 'family'));
    row(F.tocPers, pages.filter(p => p.kind === 'person'));
    row(F.tocIdx, pages.filter(p => p.kind === 'index' || p.kind === 'map'));
    return `<nav class="sp-toc-file" aria-label="${esc(F.tocTitle)}"><h2 class="sp-toc-h">${esc(F.tocTitle)}</h2>${rows.join('')}</nav>`;
}

/** The search index for the file's script (§0.7): JSON that never closes its <script> early. */
function searchIndexJson(set: PageSet): string {
    return jsonForScript(set.searchIndex);
}

function assemble(r: Render, pages: readonly SetPage[], sections: readonly string[]): string {
    const set = r.set;
    const intro = set.bySlug.get(set.introSlug);
    const fileName = pageSetFileName(set);
    // Last: every image of every page is in the registry by now.
    const body = `<style>${set.images.css()}</style>${fileTocHtml(r, pages)}`
        + `<div class="sp-results" id="sp-results" aria-live="polite" hidden></div>${sections.join('')}`
        + `<p class="sp-print-foot">${esc(r.S.familyPages.printFoot(fileName))}</p>`;
    return personPageDocumentShell(set.options.lang, intro?.title ?? fileName, body, r.opts.fontCss ?? '', '', {
        css: FAMILY_PAGES_CSS,
        mainClass: 'pp-file sp-file',
        beforeMain: barHtml(r, null),
        afterMain: `<script type="application/json" id="sp-index">${searchIndexJson(set)}</script>`
            + `<script type="application/json" id="sp-strings">${jsonForScript(searchStrings(r))}</script>`,
        ...(pages.length > 1 ? { script: PAGE_SET_SCRIPT } : {}),
    });
}

/** The whole file (§0.2), at once. */
export function buildPageSetHtml(set: PageSet, opts: PageSetHtmlOptions = {}): string {
    const r = makeRender(set, 'file', opts);
    const pages = pageSetRenderedPages(set);
    return assemble(r, pages, pages.map(p => sectionHtml(r, p)));
}

/**
 * The whole file, a page at a time (§6.5): `pause` between pages keeps the
 * app responsive (an idle callback), `progress(done, total)` after each.
 */
export async function buildPageSetHtmlAsync(set: PageSet, opts: PageSetHtmlOptions & {
    pause?: () => Promise<void>;
    progress?: (done: number, total: number) => void;
} = {}): Promise<string> {
    const r = makeRender(set, 'file', opts);
    const pages = pageSetRenderedPages(set);
    const sections: string[] = [];
    for (const p of pages) {
        sections.push(sectionHtml(r, p));
        opts.progress?.(sections.length, pages.length);
        if (opts.pause) await opts.pause();
    }
    return assemble(r, pages, sections);
}

/** One page for the app's window (§0.8): its section, links as `data-sp-open` buttons; '' for a slug the set does not draw. */
export function pageSetSectionHtml(set: PageSet, slug: string, opts: PageSetHtmlOptions = {}): string {
    const page = set.bySlug.get(slug);
    if (!page || !rendered(page)) return '';
    return sectionHtml(makeRender(set, 'app', opts), page);
}
