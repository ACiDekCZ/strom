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

import { Partnership, PartnershipId, PersonId } from './types.js';
import { getStringsForLang } from './strings.js';
import { formatFlexDate, yearOf } from './dates.js';
import { Rod } from './lineage.js';
import { buildBookModel, BookModel } from './book-model.js';
import { BOOK_PART_KEYS, BookParts } from './book-options.js';
import {
    BookCtx, BookLinkTarget, BookSourceNumbers, bookName, bookYears, founderNote, branchPageLine, indexHtml, pageLineGenerationsHtml,
    pageLineHeadHtml, pageLinePeriod, rodLineageHtml, rodOverviewHtml, rodPageLine,
} from './book-blocks.js';
import {
    PERSON_PAGE_ALL_GROUPS, PersonPageContext, PersonPageGroups, buildPersonPageBody, personPageDocumentShell,
    preparePersonPageData, PersonPageOptions,
} from './person-page.js';
import { PageSet, SetPage, familyTitle, isProtectedPerson, pageSetFileName, pageSetLivingNames } from './family-pages.js';
import { FAMILY_PAGES_CSS, PAGE_SET_SCRIPT } from './family-pages-css.js';

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
    return { set, mode, S, model, base, opts, foot: `<footer class="sp-foot">${lines.join('')}</footer>` };
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

/** "Index of this line" (§1.7): in P1 the people's index only (step E adds the others). */
function teaserHtml(r: Render, branch: boolean): string {
    const F = r.S.familyPages;
    const slug = r.set.indexSlug.persons;
    if (!slug) return '';
    return `<section class="sp-teaser"><h2 class="sp-teaser-h">${esc(branch ? F.idxTeaserBranch : F.idxTeaser)}</h2>`
        + `<div class="sp-btns">${pageLink(r, slug, esc(F.idxTabs.persons), 'sp-btn')}</div></section>`;
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

/**
 * A family's page — a stand-in until step D draws it (§2): the couple, the
 * marriage, the partners and the children, each a link.
 * TODO(D): the family page of §2.2.
 */
function familyPageHtml(r: Render, page: SetPage, ctx: BookCtx): string {
    const F = r.S.familyPages;
    const tree = r.set.protectedTree.tree;
    const u: Partnership | undefined = page.id ? tree.partnerships[page.id as PartnershipId] : undefined;
    if (!u) return '';
    const y = yearOf(u.startDate);
    const wedding = u.status === 'married' || u.status === 'divorced';
    const mar = wedding ? [`⚭${y !== null ? ` ${y}` : ''}`, u.startPlace?.trim() ?? ''].filter(Boolean).join(', ') : F.notMarried;
    const link = (id: PersonId): string => {
        const slug = r.set.personSlug.get(id);
        const name = bookName(ctx, id);
        return slug ? pageLink(r, slug, name) : name;
    };
    const partners = [u.person1Id, u.person2Id].filter((id): id is PersonId => !!id && !!tree.persons[id] && !tree.persons[id].isPlaceholder)
        .map(id => {
            const yrs = bookYears(tree.persons[id]);
            return `<div class="sp-partner"><span class="sp-partner-name">${link(id)}</span>${yrs ? `<span class="sp-yrs">${esc(yrs)}</span>` : ''}</div>`;
        }).join('');
    const kids = (u.childIds ?? []).filter(id => tree.persons[id] && !tree.persons[id].isPlaceholder).map(id => {
        const yrs = bookYears(tree.persons[id]);
        return `<li>${link(id)}${yrs ? ` <span class="sp-yrs">${esc(yrs)}</span>` : ''}</li>`;
    }).join('');
    return `<header class="sp-head"><div class="sp-kicker">${esc(F.kFam)}</div><h1 class="sp-h1">${esc(page.title)}</h1><p class="sp-sub">${esc(mar)}</p></header>`
        + `<div class="sp-partners">${partners}</div>`
        + (kids ? `<section class="sp-block"><h2 class="sp-h2">${esc(F.children)}</h2><ul class="sp-list">${kids}</ul></section>` : '');
}

/** The index of people (§1.7): the book's index, the names leading to the pages. */
function indexPageHtml(r: Render, page: SetPage, ctx: BookCtx): string {
    const F = r.S.familyPages;
    return `<header class="sp-head"><div class="sp-kicker">${esc(F.index)}</div><h1 class="sp-h1">${esc(page.title)}</h1></header>${indexHtml(ctx)}`;
}

/** The pages this step draws: the people's index only among the indexes, no map yet (step E). */
function rendered(page: SetPage): boolean {
    if (page.kind === 'index') return page.id === 'persons';
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
    else if (page.kind === 'index') body = indexPageHtml(r, page, ctx);
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
    return JSON.stringify(set.searchIndex).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');
}

function assemble(r: Render, pages: readonly SetPage[], sections: readonly string[]): string {
    const set = r.set;
    const intro = set.bySlug.get(set.introSlug);
    const fileName = pageSetFileName(set);
    // Last: every image of every page is in the registry by now.
    const body = `<style>${set.images.css()}</style>${fileTocHtml(r, pages)}${sections.join('')}`
        + `<p class="sp-print-foot">${esc(r.S.familyPages.printFoot(fileName))}</p>`;
    return personPageDocumentShell(set.options.lang, intro?.title ?? fileName, body, r.opts.fontCss ?? '', '', {
        css: FAMILY_PAGES_CSS,
        mainClass: 'pp-file sp-file',
        afterMain: `<script type="application/json" id="sp-index">${searchIndexJson(set)}</script>`,
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
