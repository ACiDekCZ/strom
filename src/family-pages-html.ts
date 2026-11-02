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

import { Partnership, PartnershipId, Person, PersonId, PlaceGeo, StromData } from './types.js';
import { getStringsForLang, Language } from './strings.js';
import { formatFlexDate, yearOf } from './dates.js';
import { Rod, RodId, rods as allRods, ancestorSlots, marriedInto, rodGenerations, rodNameForms, sortByBirth } from './lineage.js';
import { sortCoupleEvents } from './events.js';
import { shownNameOrEmpty, shownNameParts, shownSurnameIsBirth } from './person-name.js';
import { buildBookModel, BookModel } from './book-model.js';
import { BOOK_PART_KEYS, BookParts } from './book-options.js';
import {
    BookCtx, BookLinkTarget, BookSourceNumbers, bookName, bookYears, birthRodNamed, diedYoung, founderNote, branchPageLine,
    occupationOf, PageLine, pageLineGenerationsHtml, pageLineHeadHtml, pageLinePeriod, pairFirstNames, rodLabelOf, rodLineageHtml, rodOverviewHtml,
    rodPageLine, roman,
} from './book-blocks.js';
import {
    PERSON_PAGE_ALL_GROUPS, PersonPageContext, PersonPageGroups, buildPersonPageBody, coupleChapterData, coupleChapterHtml, createdWithStromHtml,
    personPageDocumentShell, prefixPageIds, preparePersonPageData, PersonPageOptions, safeImage, shownExcerpt,
} from './person-page.js';
import {
    PageSet, PageSetIndexKind, SetPage, SetPlaceRow, familyFirstNames, familyIndexLetter, familyIndexSort, familyTitle, indexLetter, indexPageOf,
    INDEX_UNCERTAIN, isGapOnlyName, isProtectedPerson, orderIndexKeys, pageSetFileName, pageSetFolders, pageSetLivingNames, pageSetPath, pageSetPlaces, pageSetSearchPeople, personIndexLetter,
    personIndexSort, surnameFirst, ZIP_PICK_LINES,
} from './family-pages.js';
import { FAMILY_PAGES_CSS, PAGE_SET_SCRIPT } from './family-pages-css.js';
import { RodPickerItem, rodPickKey, rodPickerHtml, rodPickerItems } from './rod-picker.js';
import { pluralTemplates, searchPageSetIndex } from './family-pages-search.js';
import {
    PLACES_MAP_SCRIPT, RodPlacePoint, collectRodPlacePoints, planPlacesMap, placesMapHtml, rodPlacePointSize,
} from './person-page-map.js';
import { PERSON_PAGE_SCRIPT, PERSON_PAGE_STORY_SCRIPT, personPageFileCss } from './person-page-css.js';
import { fanZoomInlineScript } from './fan-zoom.js';
import { ZipEntry, dataUrlBytes } from './zip.js';

export { indexLetter };
import { safeHttpUrl } from './validation.js';
import {
    ROD_TIMELINE_CHIPS, RodTimelineEvent, RodTimelineKind, buildRodTimeline, rodTimelineAxis, rodTimelineChip, rodTimelineMainCentury, rodTimelineTicks,
} from './rod-timeline.js';

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
    /** A set of files (§6.4): the search's links lead to the pages' files. */
    zip?: boolean;
    /** The set of files: the page being written, its way up to the set's root ('' or '../', 1102 §7.5). */
    root?: string;
    /** The lines of the introduction with their periods, once asked for. */
    hub?: HubLine[];
    /** The whole tree's choice of a line (spec 026 P3 §2.3), once asked for. */
    pick?: RodPickerItem[];
}

/** A line of the introduction: its page, its block line and its period without the protected. */
interface HubLine {
    rod: Rod;
    slug: string;
    line: PageLine;
    period: { from: number; to: number } | null;
}

function esc(text: string): string {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** The app's window only (§3.3, §9.3): " living" after a living person's years; '' in a saved file. */
function livingTagHtml(r: Render, id: PersonId | undefined): string {
    return id ? r.base.markLiving?.(id) ?? '' : '';
}

/** A card's line of years with the window's living tag; '' with neither. */
function yearsTagHtml(r: Render, id: PersonId, yrs: string, cls: string): string {
    const tag = livingTagHtml(r, id);
    return yrs || tag ? `<span class="${cls}">${esc(yrs)}${yrs ? tag : tag.trimStart()}</span>` : '';
}

/** The living tag of a search hit, by its page (a person's page; nothing for other pages). */
function livingOfPage(r: Render, slug: string | undefined): string {
    const page = slug ? r.set.bySlug.get(slug) : undefined;
    return page?.kind === 'person' && page.id ? livingTagHtml(r, page.id as PersonId) : '';
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
    if ('rodTimeline' in target) return set.rodTimelineSlug.get(target.rodTimeline) ?? '';
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
        // The window shows full data: a living person carries the tag of what the file protects (§9.3).
        ...(mode === 'app' ? {
            markLiving: (id: PersonId) => prot.living.has(id) ? ` <span class="sp-living">${esc(S.familyPages.livingTag)}</span>` : '',
        } : {}),
    };
    const lines = [`<p>${createdWithStromHtml(lang, formatFlexDate(localDay(set.options.now), lang))}</p>`];
    if (pageSetLivingNames(set).length) lines.push(`<p>${esc(S.familyPages.privacyNote[set.options.privacy])}</p>`);
    const r: Render = { set, mode, S, model, base, opts, foot: `<footer class="sp-foot">${lines.join('')}</footer>`, gens: new Map() };
    // A place of a lineage's header leads to the map with the place selected (§3.7), else to its row of the index of places (§3.5).
    base.placeLink = (key: string): string | null => {
        const map = drawnSlug(r, set.mapSlug);
        if (map && setMap(set).geo[key]) return mode === 'app' ? pageSetAppTarget(set.bySlug.get(map)!) : `#${map}`;
        const slug = drawnSlug(r, set.indexSlug.places);
        if (!slug) return null;
        if (mode === 'app') return pageSetAppTarget(set.bySlug.get(slug)!);
        const rows = placeRows(r);
        const i = rows.findIndex(p => p.key === key || !!p.alsoKeys?.includes(key));
        if (i < 0) return `#${slug}`;
        return `#${placeAnchor(indexPageOf(set, 'places', indexLetter(rows[i].name, lang)), i)}`;
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
    return page && rendered(r.set, page) ? slug : '';
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
    const cards = lines.map(({ rod, slug, line }, i) => pageLink(r, slug, rodCardInner(r, ctx, rod, line, periods[i], lo, span), 'sp-card')).join('');
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

// ─── Chosen people and a line of ancestors (1102 §4.2, §4.3) ──────────────────

/** A chosen person's short line: the birth place or the occupation, or "wife in the Lhoták line" when married into another line. */
function selPersonNote(r: Render, ctx: BookCtx, p: Person): string {
    const F = r.S.familyPages;
    const index = r.set.protectedTree.lineages;
    const into = marriedInto(index, p.id).find(m => !index.rods.get(m.rodId)?.small);
    if (into) {
        const label = rodLabel(r, ctx, into.rodId);
        if (label) return F.spouseIn[gKey(p)](label);
    }
    return p.birthPlace?.trim() || occupationOf(p);
}

/** §4.2: the introduction of chosen people — grouped by line (the tree's order), the families with a page, the indexes. */
function personsHubHtml(r: Render, page: SetPage, ctx: BookCtx): string {
    const { set, S } = r;
    const F = S.familyPages;
    const prot = set.protectedTree;
    const tree = prot.tree;
    const index = prot.lineages;
    const people = sortByBirth(tree, set.selection.personIds.filter(id => !!realIn(tree, id) && !isProtectedPerson(prot, id)));
    const order = allRods(index).filter(rod => !rod.small).map(rod => rod.id);
    const groups = new Map<RodId | 'other', PersonId[]>();
    for (const id of people) {
        const rodId = index.rodByPerson.get(id);
        const key: RodId | 'other' = rodId && !index.rods.get(rodId)?.small ? rodId : 'other';
        const list = groups.get(key) ?? [];
        list.push(id);
        groups.set(key, list);
    }
    const keys: (RodId | 'other')[] = [...order.filter(id => groups.has(id)), ...(groups.has('other') ? ['other' as const] : [])];
    const years: number[] = [];
    for (const id of people) {
        const p = tree.persons[id];
        for (const y of [yearOf(p.birthDate), yearOf(p.deathDate)]) if (y !== null) years.push(y);
    }
    const fams = set.selection.familyIds.filter(fid => set.familySlug.has(fid));
    const sub = [F.selSub(people.length, set.treeName), years.length ? `${Math.min(...years)}–${Math.max(...years)}` : '', F.nFams(fams.length)]
        .filter(Boolean).join(' · ');
    const groupHtml = keys.map(key => {
        const ids = groups.get(key)!;
        const head = key === 'other' ? F.otherFams : F.rodTitle(rodLabel(r, ctx, key));
        const rows = ids.map(id => {
            const p = tree.persons[id];
            const yrs = yearsTagHtml(r, id, bookYears(p), 'sp-yrs');
            const note = selPersonNote(r, ctx, p);
            return `<div class="sp-sel-row"><span class="sp-sel-n">${personLinkHtml(r, ctx, id)}</span>${yrs}`
                + `${note ? `<span class="sp-sel-d">${esc(note)}</span>` : ''}</div>`;
        }).join('');
        return `<section class="sp-sel-group"><h2 class="sp-sel-h">${esc(head)} · ${esc(F.nPersons(ids.length))}</h2>${rows}</section>`;
    }).join('');
    const famRows = fams.map(fid => {
        const u = tree.partnerships[fid];
        const year = isWedding(u) ? yearOf(u.startDate) : null;
        return `<div class="sp-cross-row">${familyLinkHtml(r, fid, esc(familyTitle(tree, u, set.options.lang)))}`
            + `${year !== null ? `<span class="sp-cross-rods">${year}</span>` : ''}</div>`;
    }).join('');
    const famHtml = fams.length
        ? `<section class="sp-cross"><h2 class="sp-h2">${esc(F.families)}</h2><p class="sp-row-sub">${esc(F.selFamsNote)}</p>${famRows}</section>`
        : '';
    return `<header class="sp-head"><div class="sp-kicker">${esc(F.selKicker)}</div><h1 class="sp-h1">${esc(page.title)}</h1><p class="sp-sub">${esc(sub)}</p></header>`
        + `<div class="sp-sel">${groupHtml}</div>${famHtml}${teaserHtml(r, false)}`;
}

/** The steps from the starting person to the ancestor of a Kekulé number: 'f' father, 'm' mother, the nearest first. */
function kekulePath(k: number): ('f' | 'm')[] {
    const bits = k.toString(2).slice(1);
    return [...bits].map(b => b === '0' ? 'f' : 'm');
}

/** Above this many places a generation folds (§4.3); without the script it stays open. */
const ANC_FOLD_SLOTS = 8;

/** §4.3: the line of ancestors — a heading per generation, the ancestors in Kekulé order, the missing ones muted. */
function ancestorsPageHtml(r: Render, page: SetPage, ctx: BookCtx): string {
    const { set, S } = r;
    const F = S.familyPages;
    const prot = set.protectedTree;
    const tree = prot.tree;
    const index = prot.lineages;
    const rootId = page.id as PersonId;
    const spec = set.spec;
    const depth = spec.kind === 'ancestors' && typeof spec.generations === 'number' ? spec.generations : undefined;
    const gens = ancestorSlots(tree, rootId, depth);
    const n = depth ?? Math.max(0, gens.length - 1);
    let last = 0;
    gens.forEach((g, i) => { if (g.length) last = i; });
    const known = gens.slice(1).reduce((sum, g) => sum + g.length, 0);
    let oldest: number | null = null;
    for (const g of gens.slice(1)) for (const a of g) {
        const y = yearOf(tree.persons[a.id]?.birthDate);
        if (y !== null && (oldest === null || y < oldest)) oldest = y;
    }
    const meta = F.ancMeta(n, known, Math.pow(2, n + 1) - 2, oldest);
    const rodOfAnc = (id: PersonId): string => {
        const rodId = index.rodByPerson.get(id);
        const rod = rodId ? index.rods.get(rodId) : undefined;
        if (!rod || rod.small) return F.otherFams;
        const label = rodLabel(r, ctx, rod.id);
        return label ? F.ancRod(label) : F.otherFams;
    };
    const blocks: string[] = [];
    for (let g = 0; g <= last; g++) {
        const slots = gens[g];
        const byK = new Map(slots.map(a => [a.k, a.id]));
        const prevK = g > 0 ? new Set(gens[g - 1].map(a => a.k)) : new Set<number>();
        const rows: string[] = [];
        const first = Math.pow(2, g);
        for (let k = first; k < first * 2; k++) {
            const id = byK.get(k);
            const rel = g === 0 ? '' : esc(F.ancRel(kekulePath(k)));
            if (!id) {
                // A missing ancestor only where the child is known (§4.3).
                if (!prevK.has(k >> 1)) continue;
                const gk: 'm' | 'f' = k % 2 === 0 ? 'm' : 'f';
                rows.push(`<div class="sp-anc-row sp-anc-row--none"><span class="sp-anc-rel">${rel}</span>`
                    + `<span class="sp-anc-main"><span class="sp-anc-unk">${esc(F.ancUnknown[gk])}</span></span></div>`);
                continue;
            }
            const p = tree.persons[id];
            const shielded = isProtectedPerson(prot, id);
            const yrs = g === 0 && !shielded
                ? [yearOf(p.birthDate) !== null ? `* ${yearOf(p.birthDate)}` : '', p.birthPlace?.trim() ?? ''].filter(Boolean).join(', ')
                : bookYears(p);
            rows.push(`<div class="sp-anc-row"><span class="sp-anc-rel">${rel}</span><span class="sp-anc-main">`
                + `<span class="sp-anc-n">${personLinkHtml(r, ctx, id)}</span>${yearsTagHtml(r, id, yrs, 'sp-yrs')}`
                + `<span class="sp-anc-rod">${esc(rodOfAnc(id))}</span></span></div>`);
        }
        const places = first;
        const head = `<h2 class="sp-gen-h sp-anc-h"><span class="sp-roman">${roman(g + 1)}</span><span class="sp-anc-gt">${esc(F.ancGen(g + 1))}</span>`
            + `${g > 0 ? `<span class="sp-gen-meta">${esc(F.ancOf(slots.length, places))}</span>` : ''}</h2>`;
        const list = `<div class="sp-anc-list">${rows.join('')}</div>`;
        blocks.push(places > ANC_FOLD_SLOTS && rows.length
            ? `<section class="sp-anc-gen">${head}<details class="sp-anc-more" open><summary class="sp-anc-sum">${esc(F.ancShow(rows.length))} <span aria-hidden="true">▾</span></summary>${list}</details></section>`
            : `<section class="sp-anc-gen">${head}${list}</section>`);
    }
    return `<header class="sp-head"><div class="sp-kicker">${esc(F.ancKicker)}</div><h1 class="sp-h1">${esc(page.title)}</h1><p class="sp-sub">${esc(meta)}</p></header>`
        + `<div class="sp-anc">${blocks.join('')}</div>${teaserHtml(r, false)}`;
}

/** A line's card (§1.5; the whole tree's §1.3): the name, the founder, the period on the axis, the counts. */
function rodCardInner(r: Render, ctx: BookCtx, rod: Rod, line: PageLine, period: { from: number; to: number } | null, lo: number, span: number): string {
    const F = r.S.familyPages;
    const founder = r.set.protectedTree.tree.persons[rod.founderId];
    const g = founder?.gender === 'female' ? 'f' : founder?.gender === 'male' ? 'm' : 'u';
    const founderLine = founder && !founder.isPlaceholder
        ? `${esc(F.founder[g])} ${bookName(ctx, rod.founderId)}${founderNote(ctx, rod.founderId)}` : '';
    const meta = [period ? `${period.from}–${period.to}` : '', F.nMembers(rod.realMemberCount), F.nFams(rod.familyIds.length)].filter(Boolean).join(' · ');
    return `<span class="sp-card-t">${esc(line.title)}</span>${founderLine ? `<span class="sp-card-f">${founderLine}</span>` : ''}`
        + `${barOnAxis(period, lo, span)}<span class="sp-card-m">${esc(meta)}</span><span class="sp-card-go">${esc(F.openRod)}</span>`;
}

function barOnAxis(period: { from: number; to: number } | null, lo: number, span: number): string {
    return period
        ? `<span class="sp-axis" aria-hidden="true"><span class="sp-bar" style="left:${((period.from - lo) / span * 100).toFixed(1)}%;width:${(Math.max(0.5, (period.to - period.from) / span * 100)).toFixed(1)}%"></span></span>`
        : '';
}

// ─── The whole tree (spec 026 P3 §1) ────────────────────────────────────────

/** Cards up to 12 lines, rows from 13 (§1.3). */
export const HUB_ROWS_FROM = 13;
/** Rows shown before "Show all {n} lines" (§1.3). */
const HUB_ROWS_SHOWN = 20;
/** Pairs of lines shown before the link to the index of families (§1.5). */
const HUB_PAIRS_SHOWN = 6;

/** The introduction's lines (all but the small ones, largest first) with their periods without the protected. */
function hubLines(r: Render): HubLine[] {
    if (r.hub) return r.hub;
    const { set } = r;
    r.hub = set.rodIds.map(id => rodOf(r, id)).filter((x): x is Rod => !!x).map(rod => {
        const slug = set.rodSlug.get(rod.id) ?? '';
        const line = rodPageLine(rod, r.base, set.bySlug.get(slug)?.title);
        return { rod, slug, line, period: pageLinePeriod(line, r.base) };
    });
    return r.hub;
}

/** The whole tree's axis (§1.3): from the oldest year rounded down to 50 (1700 at the latest) to this decade's end. */
function treeAxis(r: Render): { lo: number; hi: number } {
    const lo = Math.min(1700, ...hubLines(r).filter(l => !!l.period).map(l => Math.floor(l.period!.from / 50) * 50));
    const hi = Math.ceil((r.set.options.now.getFullYear() + 1) / 10) * 10;
    return { lo, hi };
}

/** The choice of a line in the whole tree's bar (§2.3). */
function rodPickHtml(r: Render, page: SetPage | null): string {
    const { set, S } = r;
    const F = S.familyPages;
    if (!r.pick) {
        const periods = new Map(hubLines(r).map(l => [l.rod.id, l.period]));
        r.pick = rodPickerItems(set.protectedTree.lineages, set, id => periods.get(id) ?? null);
    }
    const { lo, hi } = treeAxis(r);
    // A set of files repeats the choice in every file (1102 §7.5): with many lines only the
    // introduction (which lists them all) and the lines' pages carry the whole list, the
    // other pages the whole tree, their own line and Other families.
    const short = !!r.zip && set.rodIds.length > ZIP_PICK_LINES && !!page && page.kind !== 'tree' && page.kind !== 'rod' && page.kind !== 'other';
    const items = short ? r.pick.filter(i => i.id === 'tree' || i.id === 'other' || i.id === page.under) : r.pick;
    return rodPickerHtml({
        items, current: page?.under ?? null, treeTitle: set.bySlug.get(set.introSlug)?.title ?? '', lo, hi,
        texts: {
            prefix: F.rodPickPrefix, all: F.rodPickAll, wholeTree: F.wholeTree, other: F.otherFams, placeholder: F.rodPickPh,
            none: F.rodPickNone, label: F.rodPickLabel, members: F.nPersons,
        },
        link: (item, inner, cls) => item.slug ? pageLink(r, item.slug, inner, cls) : inner,
    });
}

/** The marriages between two lines of the whole tree (§1.5): neither partner a placeholder, not both protected. */
interface LinePair { a: RodId; b: RodId; label: string; fams: PartnershipId[] }

function linePairs(r: Render): LinePair[] {
    const { set } = r;
    const tree = set.protectedTree.tree;
    const index = set.protectedTree.lineages;
    const inSet = new Set(set.rodIds);
    const lang = set.options.lang;
    const byKey = new Map<string, LinePair>();
    for (const fid of set.selection.familyIds) {
        const u = tree.partnerships[fid];
        if (!u || !u.person1Id || !u.person2Id) continue;
        const ids = [u.person1Id, u.person2Id];
        if (ids.some(id => !realIn(tree, id))) continue;
        if (ids.every(id => isProtectedPerson(set.protectedTree, id))) continue;
        const rods = ids.map(id => index.rodByPerson.get(id) ?? null);
        if (!rods[0] || !rods[1] || rods[0] === rods[1] || !inSet.has(rods[0]) || !inSet.has(rods[1])) continue;
        const pair = rods.map(id => ({ id: id!, label: set.rodLabels.get(id!) || r.S.familyPages.rodGeneric }))
            .sort((x, y) => x.label.localeCompare(y.label, lang));
        const key = `${pair[0].id}\t${pair[1].id}`;
        const have = byKey.get(key);
        if (have) have.fams.push(fid);
        else byKey.set(key, { a: pair[0].id, b: pair[1].id, label: `${pair[0].label} · ${pair[1].label}`, fams: [fid] });
    }
    const year = (fid: PartnershipId): number => yearOf(tree.partnerships[fid]?.startDate) ?? 9999;
    const out = [...byKey.values()];
    for (const p of out) p.fams.sort((x, y) => year(x) - year(y) || x.localeCompare(y));
    return out.sort((x, y) => y.fams.length - x.fams.length || x.label.localeCompare(y.label, lang));
}

/** The pairs as folds (open in the markup: the script folds all but the first, `data-sp-fold`). */
function pairsHtml(r: Render, pairs: readonly LinePair[], foldFrom: number): string {
    const { set, S } = r;
    const F = S.familyPages;
    const tree = set.protectedTree.tree;
    return pairs.map((p, i) => {
        const rows = p.fams.map(fid => {
            const u = tree.partnerships[fid];
            const y = isWedding(u) ? yearOf(u.startDate) : null;
            const slug = set.familySlug.get(fid);
            return `<li class="sp-pair-r"><span class="sp-sym">⚭</span>${y !== null ? ` <span class="sp-nw">${y}</span>` : ''} ${esc(familyTitle(tree, u, set.options.lang))}`
                + `${slug ? ` · ${pageLink(r, slug, esc(F.famLink))}` : ''}</li>`;
        }).join('');
        return `<details class="sp-pair" open${i >= foldFrom ? ' data-sp-fold' : ''}><summary class="sp-pair-s"><span class="sp-pair-n">${esc(p.label)}</span>`
            + ` <span class="sp-pair-c">— ${esc(F.pairCount(p.fams.length))}</span></summary><ul class="sp-pair-l">${rows}</ul></details>`;
    }).join('');
}

/** The anchor of the marriages between lines in the index of families. */
function pairsAnchor(r: Render): string {
    return `${r.set.indexSlug.families}--mezi-rody`;
}

/** "Other families" (§1.3): the small lines' names, the first five and how many more. */
function otherNames(r: Render): string[] {
    const lang = r.set.options.lang;
    return r.set.otherRodIds.map(id => r.set.rodLabels.get(id) ?? '').filter(Boolean).sort((a, b) => a.localeCompare(b, lang));
}

/** §1.2–§1.6: the whole tree's introduction. */
function treeHubHtml(r: Render, page: SetPage, ctx: BookCtx): string {
    const { set, S } = r;
    const F = S.familyPages;
    const lang = set.options.lang;
    const prot = set.protectedTree;
    const tree = prot.tree;
    const lines = hubLines(r);
    const { lo, hi } = treeAxis(r);
    const span = Math.max(1, hi - lo);

    // The counts (§1.2): the period up to the last unprotected record, the people with the living, lines, families, generations.
    let from = Infinity, to = -Infinity;
    const note = (date: string | undefined): void => {
        const y = yearOf(date);
        if (y === null) return;
        from = Math.min(from, y);
        to = Math.max(to, y);
    };
    let persons = 0;
    for (const id of set.selection.personIds) {
        const p = realIn(tree, id);
        if (!p) continue;
        persons++;
        if (isProtectedPerson(prot, id)) continue;
        note(p.birthDate);
        note(p.deathDate);
    }
    for (const fid of set.selection.familyIds) {
        const u = tree.partnerships[fid];
        if (u && ![u.person1Id, u.person2Id].some(id => id && isProtectedPerson(prot, id))) note(u.startDate);
    }
    const gens = Math.max(0, ...lines.map(l => l.rod.generations));
    const counts = [
        from <= to ? (from === to ? String(from) : `${from}–${to}`) : '', F.nPersons(persons), F.nRods(lines.length),
        F.nFams(set.selection.familyIds.length), gens ? F.nGens(gens) : '',
    ].filter(Boolean).map(x => `<span>${esc(x)}</span>`).join('');
    const places = [...placeRows(r)].sort((a, b) => b.personIds.length - a.personIds.length || a.name.localeCompare(b.name, lang));
    const placeLinkHtml = (key: string, html: string): string => {
        const to = r.base.placeLink?.(key);
        if (!to) return html;
        return r.mode === 'file' ? `<a class="pp-link" href="${esc(to)}">${html}</a>` : `<button type="button" class="pp-link" data-sp-open="${esc(to)}">${html}</button>`;
    };
    const map = drawnSlug(r, set.mapSlug);
    const main = places.slice(0, 3).map(p => placeLinkHtml(p.key, esc(p.name)));
    if (places.length > 3) main.push(`<span class="sp-faint">${esc(F.morePlaces(places.length - 3))}</span>`);
    if (map) main.push(pageLink(r, map, esc(F.map)));
    const head = `<header class="sp-head sp-head--tree"><div class="sp-kicker">${esc(F.kTree)}</div><h1 class="sp-h1">${esc(page.title)}</h1>`
        + `<p class="sp-sub sp-counts">${counts}</p>`
        + (places.length ? `<p class="sp-mainpl"><span class="sp-mainpl-k">${esc(F.mainPlaces)}:</span> ${main.join('\u00a0<span class="sp-sep" aria-hidden="true">·</span> ')}</p>` : '')
        + `</header>`;

    // The lines (§1.3): sorted by size, by age or by name (the script; the markup by size).
    const order = (key: (l: HubLine) => number | string): number[] => {
        const idx = lines.map((_, i) => i).sort((a, b) => {
            const x = key(lines[a]), y = key(lines[b]);
            return typeof x === 'number' && typeof y === 'number' ? x - y || a - b : String(x).localeCompare(String(y), lang) || a - b;
        });
        const rank: number[] = [];
        idx.forEach((li, i) => { rank[li] = i; });
        return rank;
    };
    const byOld = order(l => l.period?.from ?? 99999);
    const byAbc = order(l => set.rodLabels.get(l.rod.id) || l.rod.surname);
    const sortKey = (i: number): string => `${i} ${byOld[i]} ${byAbc[i]}`;
    const withKey = (html: string, i: number, extra = ''): string => html.replace(/^<(a|button) /, `<$1 data-sp-o="${sortKey(i)}"${extra} `);
    const seg = lines.length > 1
        ? `<div class="sp-sort js-only" role="radiogroup" aria-label="${esc(F.sortLabel)}">`
            + ([['size', F.sortSize], ['old', F.sortOld], ['abc', F.sortAbc]] as const)
                .map(([k, l], i) => `<button type="button" role="radio" data-sp-sort="${i}" aria-checked="${i === 0}">${esc(l)}</button>`).join('')
            + `</div>`
        : '';
    const otherDesc = F.otherDesc(set.otherRodIds.length, set.otherPersonIds.length);
    const rowsMode = lines.length >= HUB_ROWS_FROM;
    let list: string;
    if (!rowsMode) {
        // A line's timeline beside its card (§1.3): a link of its own, over the card's corner.
        const card = (l: HubLine, i: number): string => {
            const html = pageLink(r, l.slug, rodCardInner(r, ctx, l.rod, l.line, l.period, lo, span), 'sp-card');
            const tl = set.rodTimelineSlug.get(l.rod.id);
            if (!tl) return withKey(html, i);
            return `<div class="sp-cardw" data-sp-o="${sortKey(i)}">${html}${pageLink(r, tl, esc(F.timelineLink), 'pp-link sp-card-tl')}</div>`;
        };
        const cards = lines.map(card).join('');
        let other = '';
        if (set.otherSlug) {
            const names = otherNames(r);
            const shown = names.slice(0, 5).join(', ') + (names.length > 5 ? ` ${F.otherMoreNames(names.length - 5)}` : '');
            other = pageLink(r, set.otherSlug, `<span class="sp-card-t">${esc(F.otherFams)}</span>${otherDesc ? `<span class="sp-card-f">${esc(otherDesc)}</span>` : ''}`
                + `${shown ? `<span class="sp-card-m">${esc(shown)}</span>` : ''}<span class="sp-card-go">${esc(F.otherOpen)}</span>`, 'sp-card sp-card--other');
        }
        list = `<div class="sp-cards sp-sortable">${cards}${other}</div>`;
    } else {
        const ticks: string[] = [];
        for (let y = Math.ceil(lo / 100) * 100; y <= hi; y += 100) ticks.push(`<span style="left:${((y - lo) / span * 100).toFixed(1)}%">${y}</span>`);
        const rows = lines.map((l, i) => {
            const label = set.rodLabels.get(l.rod.id) || l.rod.surname;
            const key = rodPickKey([label, ...l.rod.forms, ...l.rod.otherForms].join(' '));
            const inner = `<span class="sp-rrow-n">${esc(label)}</span>${barOnAxis(l.period, lo, span) || '<span class="sp-axis" aria-hidden="true"></span>'}`
                + `<span class="sp-rrow-c">${l.rod.realMemberCount}</span>`;
            return `<li class="sp-rrow" data-q="${esc(key)}" data-sp-o="${sortKey(i)}">${pageLink(r, l.slug, inner, 'sp-rrow-a')}</li>`;
        }).join('');
        const all = lines.length > HUB_ROWS_SHOWN
            ? `<button type="button" class="sp-rrows-all js-only" data-sp-shown="${HUB_ROWS_SHOWN}">${esc(F.showAllRods(lines.length))} <span aria-hidden="true">▾</span></button>` : '';
        const other = set.otherSlug
            ? pageLink(r, set.otherSlug, `<span class="sp-orow-n">${esc(F.otherFams)}</span>${otherDesc ? `<span class="sp-orow-d">${esc(otherDesc)}</span>` : ''}`
                + `<span class="sp-orow-go" aria-hidden="true">→</span>`, 'sp-orow') : '';
        list = `<div class="sp-rods-f js-only"><label class="sp-search sp-rods-s"><span class="sp-ico" aria-hidden="true"></span>`
            + `<input class="sp-q sp-rods-q" type="search" placeholder="${esc(F.rodsSearch)}" aria-label="${esc(F.rodsSearch)}" autocomplete="off" spellcheck="false"></label></div>`
            + `<div class="sp-raxis" aria-hidden="true"><span class="sp-raxis-t">${ticks.join('')}</span></div>`
            + `<ol class="sp-rrows sp-sortable"${all ? ` data-sp-cut="${HUB_ROWS_SHOWN}"` : ''}>${rows}</ol>`
            + `<p class="sp-rodpick-none sp-rrows-none" hidden>${esc(F.rodPickNone)}</p>${all}${other}`;
    }
    const rodsHtml = lines.length || set.otherSlug
        ? `<section class="sp-rods${rowsMode ? ' sp-rods--rows' : ''}"><div class="sp-rods-head"><h2 class="sp-h2">${esc(F.rodsH)}</h2>${seg}</div>${list}</section>` : '';

    // The marriages between lines (§1.5), grouped by pairs.
    const pairs = linePairs(r);
    let pairsBlock = '';
    if (pairs.length) {
        const n = pairs.reduce((s, p) => s + p.fams.length, 0);
        const shown = pairs.slice(0, HUB_PAIRS_SHOWN);
        const rest = pairs.slice(HUB_PAIRS_SHOWN);
        const more = rest.length
            ? `<p class="sp-pairs-more">${anchorLink(r, set.indexSlug.families, pairsAnchor(r), esc(F.pairsMore(rest.length, rest.reduce((s, p) => s + p.fams.length, 0))))}</p>` : '';
        pairsBlock = `<section class="sp-pairs"><h2 class="sp-h2">${esc(F.crossTitle)}</h2><p class="sp-pairs-head">${esc(F.pairs(n, pairs.length))}</p>`
            + `<div class="sp-pairs-l">${pairsHtml(r, shown, 1)}</div>${more}</section>`;
    }

    // The indexes (§1.6).
    const links = (['persons', 'families', 'surnames', 'places'] as const)
        .map(k => [drawnSlug(r, set.indexSlug[k]), F.idxTabs[k]] as const)
        .concat([[map, F.map] as const])
        .filter(([slug]) => !!slug)
        .map(([slug, label]) => pageLink(r, slug, esc(label), 'sp-btn'));
    const idx = links.length ? `<section class="sp-idx"><h2 class="sp-h2">${esc(F.idxH)}</h2><div class="sp-btns">${links.join('')}</div></section>` : '';
    return `${head}${rodsHtml}${pairsBlock}${idx}`;
}

/** §1.4: "Other families" — a block per small line, then the people outside the lines. */
function otherFamiliesHtml(r: Render, page: SetPage): string {
    const { set, S } = r;
    const F = S.familyPages;
    const lang = set.options.lang;
    const prot = set.protectedTree;
    const tree = prot.tree;
    const inSel = new Set(set.selection.personIds);
    const intro = set.bySlug.get(set.introSlug);
    const rods = set.otherRodIds.map(id => rodOf(r, id)).filter((x): x is Rod => !!x)
        .map(rod => ({ rod, label: set.rodLabels.get(rod.id) || rod.surname }))
        .sort((a, b) => a.label.localeCompare(b.label, lang));
    const letters: string[] = [];
    const firstOf = new Map<string, string>();
    for (const { rod, label } of rods) {
        const l = indexLetter(label, lang);
        if (!l || firstOf.has(l)) continue;
        firstOf.set(l, set.otherAnchor.get(rod.id) ?? '');
        letters.push(l);
    }
    const noneAnchor = `${page.slug}--bez-prijmeni`;
    const jump = (anchor: string, html: string): string => r.mode === 'file'
        ? `<a class="sp-letter" href="#${esc(anchor)}">${html}</a>`
        : `<button type="button" class="sp-letter" data-sp-jump="${esc(anchor)}">${html}</button>`;
    const alpha = letters.map(l => jump(firstOf.get(l)!, esc(l)));
    if (set.otherPersonIds.length) alpha.push(jump(noneAnchor, esc(F.noSurname)));
    const yearsOf = (p: Person): string => bookYears(p);
    const blocks = rods.map(({ rod, label }) => {
        const ids = sortByBirth(tree, rod.memberIds.filter(id => inSel.has(id) && realIn(tree, id)));
        let from = Infinity, to = -Infinity;
        const rows = ids.map(id => {
            const p = tree.persons[id];
            const shielded = isProtectedPerson(prot, id);
            if (!shielded) for (const d of [p.birthDate, p.deathDate]) {
                const y = yearOf(d);
                if (y !== null) { from = Math.min(from, y); to = Math.max(to, y); }
            }
            const y = yearsOf(p);
            const unions = (p.partnerships ?? []).map(uid => tree.partnerships[uid]).filter((u): u is Partnership => !!u).map(u => {
                const other = u.person1Id === id ? u.person2Id : u.person1Id;
                const o = realIn(tree, other);
                const yr = isWedding(u) ? yearOf(u.startDate) : null;
                const fam = set.familySlug.get(u.id);
                if (!o && !fam) return '';
                return `<span class="sp-ofam-u"><span class="sp-sym">⚭</span>${yr !== null ? ` ${yr}` : ''}${o ? ` ${personNameLink(r, o.id, esc(shownNameOrEmpty(o) || '?'))}` : ''}`
                    + `${fam ? ` · ${pageLink(r, fam, esc(F.famLink))}` : ''}</span>`;
            }).filter(Boolean).join('');
            const under = set.bySlug.get(set.personSlug.get(id) ?? '')?.under;
            const into = under && under !== 'other' && under !== rod.id
                ? `<span class="sp-ofam-to">${rodLinkHtml(r, under, esc(F.toRod(set.rodLabels.get(under) || F.rodGeneric)))}</span>` : '';
            return `<li class="sp-ofam-p">${personNameLink(r, id, esc(shownNameOrEmpty(p) || '?'))}${y ? ` <span class="sp-ix-y">${esc(y)}</span>` : ''}${livingTagHtml(r, id)}`
                + `${unions}${into}</li>`;
        }).join('');
        const period = from <= to ? (from === to ? String(from) : `${from}–${to}`) : '';
        const meta = [F.nPersons(ids.length), period].filter(Boolean).join(' · ');
        return `<section class="sp-ofam" id="${esc(set.otherAnchor.get(rod.id) ?? '')}"><h2 class="sp-ofam-h">${esc(label)}</h2>`
            + `<p class="sp-ofam-m">${esc(meta)}</p><ul class="sp-ofam-l">${rows}</ul></section>`;
    }).join('');
    let none = '';
    if (set.otherPersonIds.length) {
        const ids = sortByBirth(tree, [...set.otherPersonIds]);
        const names = ids.map(id => {
            const p = tree.persons[id];
            const y = yearsOf(p);
            return `<span class="sp-ofam-who">${personNameLink(r, id, esc(shownNameOrEmpty(p) || '?'))}${y ? ` <span class="sp-ix-y">${esc(y)}</span>` : ''}${livingTagHtml(r, id)}</span>`;
        }).join('');
        none = `<section class="sp-ofam sp-ofam--none" id="${esc(noneAnchor)}"><h2 class="sp-ofam-h">${esc(F.noSurname)}</h2>`
            + `<p class="sp-ofam-m">${esc(F.noSurnameNote(ids.length))}</p><p class="sp-ofam-names">${names}</p></section>`;
    }
    const desc = F.otherDesc(set.otherRodIds.length, set.otherPersonIds.length);
    return `<header class="sp-head"><div class="sp-kicker">${esc(intro?.title ?? '')}</div><h1 class="sp-h1">${esc(F.otherFams)}</h1>`
        + `<p class="sp-sub">${esc([desc ? `${desc}.` : '', F.otherIntro].filter(Boolean).join(' '))}</p></header>`
        + (alpha.length > 1 ? `<nav class="sp-letters sp-ofam-abc" aria-label="${esc(F.otherFams)}">${alpha.join('')}</nav>` : '')
        + `<div class="sp-ofams">${blocks}${none}</div>`;
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
    if (slug) return pageLink(r, slug, html);
    const anchor = r.set.otherAnchor.get(rodId);
    return anchor ? anchorLink(r, r.set.otherSlug, anchor, html) : html;
}

/** A link to an anchor inside a page: `#{anchor}` in the file, the page itself in the window. */
function anchorLink(r: Render, slug: string, anchor: string, html: string, cls = 'pp-link'): string {
    if (!drawnSlug(r, slug)) return html;
    return r.mode === 'file' ? `<a class="${cls}" href="#${esc(anchor)}">${html}</a>` : pageLink(r, slug, html, cls);
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
        + `<span class="sp-partner-name">${personLinkHtml(r, ctx, p.id)}</span>${yearsTagHtml(r, p.id, yrs, 'sp-yrs')}</div></div>`
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

/**
 * The marriage's record excerpt (§2.2, §9.9): first a source cited at the
 * wedding itself (the union's own citations, which GEDCOM writes under MARR;
 * a marriage register among them before the rest), then the first excerpt
 * of the union's other sources (its events'); none: no block.
 */
function marriageClip(r: Render, u: Partnership): { src: string; caption: string; scan: string } | null {
    const sources = r.set.protectedTree.tree.sources ?? {};
    const own = u.sourceIds ?? [];
    // A marriage register by its title, at a word's start ("Soupis poddaných" is not one).
    const isRegister = (id: string) => /(?:^|[^\p{L}])(?:odda[cnč]|sňat|marriage|trau|heirat|ehe)/iu.test(sources[id]?.title ?? '');
    const wedding = [...own.filter(isRegister), ...own];
    const rest = sortCoupleEvents(u.events ?? []).flatMap(e => e.sourceIds ?? []);
    for (const sid of new Set([...wedding, ...rest])) {
        const s = sources[sid];
        for (const e of s?.excerpts ?? []) {
            const src = shownExcerpt(e);
            if (!src) continue;
            // Its scan in the archive, as under the person page's excerpt: its own page, else the source's.
            const P = r.S.personPage.sources;
            const page = safeHttpUrl(e.pageUrl);
            const href = page ?? safeHttpUrl(s.url);
            const scan = href ? `<a href="${esc(href)}" rel="noopener noreferrer" target="_blank">${esc(page ? P.archiveScan : P.archivePage)} ↗</a>` : '';
            return { src, caption: [s.title?.trim(), s.reference?.trim()].filter(Boolean).join(', '), scan };
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
            // The window: the app's image viewer, as the person page's excerpts (src/ui/person-page-ui.ts).
            clipHtml = `<button type="button" class="sp-clip" data-pp-zoom aria-label="${esc(`${r.S.personPage.zoom}: ${clip.caption || P.clip}`)}">`
                + `<img class="sp-clip-img" src="${esc(clip.src)}" alt="${esc(clip.caption || P.clip)}" loading="lazy">${cap}</button>`;
        }
        if (clipHtml) clipHtml = `<div class="sp-clipbox">${clipHtml}${clip.scan ? `<p class="sp-clip-scan">${clip.scan}</p>` : ''}</div>`;
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
        }
        // Nothing else (§9.2): a marriage missing from the data is no fact, so no "unmarried".
    }
    const yrs = bookYears(c);
    return `<div class="sp-kidcard${young ? ' sp-kidcard--young' : ''}"><span class="sp-kid-name">${personLinkHtml(r, ctx, c.id)}</span>`
        + yearsTagHtml(r, c.id, yrs, 'sp-yrs')
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
    const whole = set.spec.kind === 'tree';
    const pick = whole ? rodPickHtml(r, page) : '';
    // On a phone the choice replaces the name on the pages of a line (§2.3); the file's script marks it per page.
    const cls = whole ? ` sp-fbar--tree${page?.under ? ' sp-fbar--rod' : ''}` : '';
    return `<div class="sp-fbar${cls}"><div class="sp-fbar-in">${home}${pick}<span class="sp-fbar-gap"></span>`
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
        lbHint: F.lbHint,
        // The set of files (1102 §7.5): a hit leads to the people's folder, the index to its file, both from the page's folder.
        ...(r.zip ? { zip: true, root: r.root ?? '', pdir: `${pageSetFolders(set).persons}/`, idxp: drawnSlug(r, set.indexSlug.persons) ? pageSetPath(set, set.indexSlug.persons) : '' } : {}),
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
    return searchHtml(makeRender(set, opts.mode ?? 'app', opts), query);
}

function searchHtml(r: Render, query: string): string {
    const set = r.set;
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
        + `${e.y ? ` <span class="sp-res-y">${esc(e.y)}</span>` : ''}${livingOfPage(r, e.s)}${e.t ? ` <span class="sp-res-t">${esc(e.t)}</span>` : ''}</li>`).join('');
    const more = res.total > res.hits.length ? `<p class="sp-res-more">${toIndex(esc(F.searchMore(res.total - res.hits.length)))}</p>` : '';
    return `<p class="sp-res-head">${esc(F.searchResults(res.total, q))}</p><ul class="sp-res-list">${rows}</ul>${more}`;
}

/** The bar of a page in the app's window (§3.3): the file's bar, its links `data-sp-open` buttons. */
export function pageSetBarHtml(set: PageSet, slug: string, opts: PageSetHtmlOptions = {}): string {
    return barHtml(makeRender(set, 'app', opts), set.bySlug.get(slug) ?? null);
}

// ─── The indexes (§3.5) ─────────────────────────────────────────────────────

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
function personsIndexHtml(r: Render, page: SetPage): string {
    const slug = page.slug;
    const { set, S } = r;
    const F = S.familyPages;
    const lang = set.options.lang;
    const tree = set.protectedTree.tree;
    const ids = pageSetSearchPeople(set);
    const items = ids.map((id, i) => {
        const e = set.searchIndex[i];
        const parts = shownNameParts(tree.persons[id]!);
        const sur0 = parts.surname.trim();
        // A surname of unreadable places only ("[?]") stands without a surname in the index (1102).
        const sur = isGapOnlyName(sur0) ? '' : sur0;
        const giv = parts.given.trim();
        const prot = isProtectedPerson(set.protectedTree, id);
        const shown = prot ? e.n : sur0 && giv ? `${sur0}, ${giv}` : sur0 || giv || e.n;
        const p = tree.persons[id]!;
        return { id, e, shown, sur, sort: personIndexSort(p), letter: personIndexLetter(p, lang) };
    }).sort((a, b) => a.sort.localeCompare(b.sort, lang) || a.e.y.localeCompare(b.e.y));
    if (!items.length) return emptyIndex(r);
    if (page.letter !== undefined) return personsLetterHtml(r, page, items.filter(it => it.letter === page.letter));
    const groups = new Map<string, typeof items>();
    for (const it of items) {
        const g = groups.get(it.letter);
        if (g) g.push(it); else groups.set(it.letter, [it]);
    }
    const keys = orderIndexKeys(groups.keys());
    const label = (k: string): string => k === INDEX_UNCERTAIN ? F.idxUncertain : k || S.book.noSurname;
    const letter = (key: string, n: number | null, text: string, title = ''): string => {
        const cur = n === null ? ' aria-current="true"' : '';
        const val = n === null ? '' : String(n);
        const t = title ? ` title="${esc(title)}" aria-label="${esc(title)}"` : '';
        return r.mode === 'file'
            ? `<a class="sp-letter" href="#${esc(n === null ? slug : `${slug}--pis-${n}`)}" data-sp-letter="${val}"${cur}${t}>${esc(text)}</a>`
            : `<button type="button" class="sp-letter" data-sp-letter="${val}"${cur}${t}>${esc(text)}</button>`;
    };
    // The uncertain readings' button is "?", named in full (1102).
    const letters = `<nav class="sp-letters" aria-label="${esc(F.idxLetters)}">${letter(slug, null, F.idxAll)}`
        + `${keys.map((k, i) => k === INDEX_UNCERTAIN ? letter(slug, i + 1, k, label(k)) : letter(slug, i + 1, label(k))).join('')}</nav>`;
    const body = keys.map((k, i) => {
        const rows = groups.get(k)!.map(it => `<li class="sp-ix-row">${personNameLink(r, it.id, esc(it.shown), 'pp-link sp-ix-n')}`
            + `${it.e.y ? ` <span class="sp-ix-y">${esc(it.e.y)}</span>` : ''}${livingTagHtml(r, it.id)}${it.e.t ? ` <span class="sp-ix-t">${esc(it.e.t)}</span>` : ''}</li>`).join('');
        return `<div class="sp-ix-group" id="${esc(`${slug}--pis-${i + 1}`)}" data-sp-group="${i + 1}"><h2 class="sp-ix-letter">${esc(label(k))}</h2>`
            + `<ul class="sp-ix-list">${rows}</ul></div>`;
    }).join('');
    return letters + body;
}

/** Families with a page: "Josef Fíšek ⚭ Anna Kvapilová · 1846 · 7 children". */
function familiesIndexHtml(r: Render, page: SetPage): string {
    const { set, S } = r;
    const F = S.familyPages;
    const lang = set.options.lang;
    const tree = set.protectedTree.tree;
    const split = page.letter !== undefined;
    const fams = set.selection.familyIds.filter(fid => set.familySlug.has(fid) && tree.partnerships[fid]
        && (!split || familyIndexLetter(tree, tree.partnerships[fid], lang) === page.letter)).map(fid => {
        const u = tree.partnerships[fid];
        const ps = coupleOf(tree, u);
        return { u, ps, sort: familyIndexSort(tree, u), year: isWedding(u) ? yearOf(u.startDate) : null };
    }).sort((a, b) => a.sort.localeCompare(b.sort, lang) || (a.year ?? 9999) - (b.year ?? 9999));
    if (!fams.length) return emptyIndex(r);
    const rows = fams.map(({ u, ps, year }) => {
        const names = ps.map(p => esc(shownNameOrEmpty(p) || '?')).join(year !== null || isWedding(u) ? ' ⚭ ' : ` ${esc(S.book.and)} `);
        const kids = (u.childIds ?? []).filter(id => realIn(tree, id)).length;
        return `<li class="sp-ix-row">${pageLink(r, set.familySlug.get(u.id)!, names, 'pp-link sp-ix-n')}`
            + `${year !== null ? ` <span class="sp-ix-y">${year}</span>` : ''} <span class="sp-ix-t">${esc(kids ? F.nKids(kids) : F.noKids)}</span></li>`;
    }).join('');
    // The whole tree: all the marriages between lines by pairs (the introduction shows six, §1.5); a split index on its first page.
    const pairs = set.spec.kind === 'tree' && page.slug === set.indexSlug.families ? linePairs(r) : [];
    const between = pairs.length
        ? `<h2 class="sp-ix-h2" id="${esc(pairsAnchor(r))}">${esc(F.crossTitle)}</h2><div class="sp-pairs-l">${pairsHtml(r, pairs, Infinity)}</div>` : '';
    const list = `<ul class="sp-ix-list">${rows}</ul>${between}`;
    return split ? letterPageHtml(r, page, list, null) : list;
}

/** A row that unfolds the people it stands for (open without the script). */
function foldRowHtml(r: Render, id: string, head: string, people: readonly PersonId[]): string {
    const tree = r.set.protectedTree.tree;
    const sub = people.map(pid => {
        const p = tree.persons[pid];
        const y = p ? bookYears(p) : '';
        return `<li>${personNameLink(r, pid, esc(p ? shownNameOrEmpty(p) || '?' : '?'))}${y ? ` <span class="sp-ix-y">${esc(y)}</span>` : ''}${livingTagHtml(r, pid)}</li>`;
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
    // The whole tree (§6.2): counts without the protected (a surname of the protected alone is left out), the small lines too.
    const whole = set.spec.kind === 'tree';
    const rodRows = [...set.rodIds, ...(whole ? set.otherRodIds : [])].map(rid => {
        const rod = rodOf(r, rid);
        if (!rod) return '';
        const label = set.rodLabels.get(rid) ?? '';
        const n = rod.memberIds.filter(id => inSel.has(id) && realIn(tree, id) && !(whole && isProtectedPerson(set.protectedTree, id))).length;
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
        if (!last || isGapOnlyName(last)) continue;
        const list = bySurname.get(last);
        if (list) list.push(id); else bySurname.set(last, [id]);
    }
    // A surname starting with an unreadable place after the others (1102).
    const rank = (last: string): number => indexLetter(last, lang) === INDEX_UNCERTAIN ? 1 : 0;
    const birth = [...bySurname.entries()].sort((a, b) => rank(a[0]) - rank(b[0]) || a[0].localeCompare(b[0], lang)).map(([last, ids]) =>
        foldRowHtml(r, '', `<span class="sp-ix-n">${esc(last)}</span> <span class="sp-ix-y">${esc(F.nPersons(ids.length))}</span>`, sortByBirth(tree, ids)));
    if (!rodRows.length && !birth.length) return emptyIndex(r);
    return `${rodRows.length ? `<ul class="sp-ix-list">${rodRows.join('')}</ul>` : ''}`
        + `${birth.length ? `<h2 class="sp-ix-h2">${esc(F.birthSurnames)}</h2><div class="sp-ix-folds">${birth.join('')}</div>` : ''}`;
}

/** Places: "Čapkov · 1702–2010 · 37 people", unfolding who had a record there (the protected left out). */
function placesIndexHtml(r: Render, page: SetPage): string {
    const F = r.S.familyPages;
    const slug = page.slug;
    const lang = r.set.options.lang;
    const all = placeRows(r);
    if (!all.length) return emptyIndex(r);
    // A split index (1102 §7.4): the letter's places, their anchors by their place in the whole index.
    const rows = all.map((p, i) => ({ p, i })).filter(x => page.letter === undefined || indexLetter(x.p.name, lang) === page.letter);
    const folds = `<div class="sp-ix-folds">${rows.map(({ p, i }) => foldRowHtml(r, placeAnchor(slug, i),
        `<span class="sp-ix-n">${esc(p.name)}</span> <span class="sp-ix-dot" aria-hidden="true">·</span> <span class="sp-ix-y">${p.from === p.to ? p.from : `${p.from}–${p.to}`}</span>`
        + ` <span class="sp-ix-dot" aria-hidden="true">·</span> <span class="sp-ix-t">${esc(F.nPersons(p.personIds.length))}</span>`, p.personIds)).join('')}</div>`;
    return page.letter === undefined ? folds : letterPageHtml(r, page, folds, null);
}

/** The letters of a language's alphabet for a split index (1102 §7.4); a letter of the names not among them is added. */
const INDEX_ALPHABET: Record<Language, string[]> = {
    cs: 'A B C Č D E F G H Ch I J K L M N O P Q R Ř S Š T U V W X Y Z Ž'.split(' '),
    en: 'A B C D E F G H I J K L M N O P Q R S T U V W X Y Z'.split(' '),
    de: 'A B C D E F G H I J K L M N O P Q R S T U V W X Y Z'.split(' '),
    pl: 'A Ą B C Ć D E Ę F G H I J K L Ł M N Ń O Ó P Q R S Ś T U V W X Y Z Ź Ż'.split(' '),
};

/**
 * A page of a split index (1102 §7.4): the alphabet above (a letter without
 * rows muted, the page's own current), the rows, then "‹ K" · the hint · "M ›".
 * `meta` is the line under the alphabet (the count of the letter's rows).
 */
function letterPageHtml(r: Render, page: SetPage, body: string, meta: string | null): string {
    const F = r.S.familyPages;
    const kind = page.id as PageSetIndexKind;
    const letters = r.set.indexLetters[kind];
    const have = new Map(letters.map(l => [l.key, l.slug]));
    const alphabet = [...(INDEX_ALPHABET[r.set.options.lang] ?? INDEX_ALPHABET.en)];
    for (const l of letters) if (l.key && l.key !== INDEX_UNCERTAIN && !alphabet.includes(l.key)) alphabet.push(l.key);
    if (have.has(INDEX_UNCERTAIN)) alphabet.push(INDEX_UNCERTAIN);
    if (have.has('')) alphabet.push('');
    const label = (k: string): string => k === INDEX_UNCERTAIN ? F.idxUncertain : k || r.S.book.noSurname;
    const cells = alphabet.map(k => {
        const slug = have.get(k);
        // The uncertain readings' cell is "?", named in full (1102).
        const text = k === INDEX_UNCERTAIN ? k : label(k);
        if (k === INDEX_UNCERTAIN && slug && k !== page.letter) {
            return pageLink(r, slug, esc(text), 'sp-abc-l').replace(/^<(a|button)\b/, `<$1 title="${esc(label(k))}" aria-label="${esc(label(k))}"`);
        }
        const named = k === INDEX_UNCERTAIN ? ` title="${esc(label(k))}" aria-label="${esc(label(k))}"` : '';
        if (k === page.letter) return `<span class="sp-abc-l" aria-current="page"${named}>${esc(text)}</span>`;
        return slug ? pageLink(r, slug, esc(text), 'sp-abc-l') : `<span class="sp-abc-l sp-abc-off" aria-disabled="true">${esc(text)}</span>`;
    }).join('');
    const at = letters.findIndex(l => l.key === page.letter);
    const prev = at > 0 ? letters[at - 1] : null;
    const next = at >= 0 && at < letters.length - 1 ? letters[at + 1] : null;
    const pager = `<nav class="sp-abc-pager" aria-label="${esc(F.idxLetters)}">`
        + `${prev ? pageLink(r, prev.slug, `‹ ${esc(label(prev.key))}`, 'sp-abc-step') : '<span class="sp-abc-step"></span>'}`
        + `<span class="sp-abc-hint">${esc(F.idxHint)}</span>`
        + `${next ? pageLink(r, next.slug, `${esc(label(next.key))} ›`, 'sp-abc-step sp-abc-next') : '<span class="sp-abc-step"></span>'}</nav>`;
    return `<nav class="sp-abc" aria-label="${esc(F.idxLetters)}">${cells}</nav>`
        + `${meta ? `<p class="sp-abc-meta">${esc(meta)}</p>` : ''}${body}${pager}`;
}

/**
 * A letter's page of the index of people (1102 §7.4): the rows grouped by
 * surname — a line's surname with its other forms and the feminine ones.
 */
function personsLetterHtml(r: Render, page: SetPage, items: { id: PersonId; e: { y: string; t: string }; shown: string; sur: string }[]): string {
    const { set, S } = r;
    const F = S.familyPages;
    const lang = set.options.lang;
    const tree = set.protectedTree.tree;
    // A surname of a line goes under the line's surname (its forms, the feminine ones).
    const lineOf = new Map<string, Rod>();
    for (const rid of [...set.rodIds, ...set.otherRodIds]) {
        const rod = rodOf(r, rid);
        if (!rod) continue;
        const nf = rodNameForms(rod, tree);
        for (const f of [rod.surname, ...nf.forms, ...nf.feminine]) {
            const k = f.trim().toLocaleLowerCase(lang);
            if (k && !lineOf.has(k)) lineOf.set(k, rod);
        }
    }
    const groups = new Map<string, { head: string; rod: Rod | null; rows: typeof items }>();
    for (const it of items) {
        const rod = it.sur ? lineOf.get(it.sur.toLocaleLowerCase(lang)) ?? null : null;
        const head = rod ? rod.surname : it.sur;
        const key = rod ? `rod:${rod.id}` : `s:${head.toLocaleLowerCase(lang)}`;
        const g = groups.get(key);
        if (g) g.rows.push(it); else groups.set(key, { head, rod, rows: [it] });
    }
    const body = [...groups.values()].sort((a, b) => a.head.localeCompare(b.head, lang)).map(g => {
        let forms = '';
        if (g.rod) {
            const nf = rodNameForms(g.rod, tree);
            const other = nf.forms.filter(f => f !== g.head);
            const bits = [other.length ? F.idxAlso(other.join(', ')) : '', nf.feminine.length ? F.feminine(nf.feminine.join(', ')) : ''].filter(Boolean);
            if (bits.length) forms = ` <span class="sp-ix-forms">${esc(bits.join(' · '))}</span>`;
        }
        const rows = g.rows.map(it => `<li class="sp-ix-row">${personNameLink(r, it.id, esc(it.shown), 'pp-link sp-ix-n')}`
            + `${it.e.y ? ` <span class="sp-ix-y">${esc(it.e.y)}</span>` : ''}${livingTagHtml(r, it.id)}${it.e.t ? ` <span class="sp-ix-t">${esc(it.e.t)}</span>` : ''}</li>`).join('');
        return `<div class="sp-ix-group"><h2 class="sp-ix-letter">${esc(g.head || S.book.noSurname)}${forms}</h2><ul class="sp-ix-list">${rows}</ul></div>`;
    }).join('');
    return letterPageHtml(r, page, body, F.nPersons(items.length));
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
    if (kind === 'persons') body = personsIndexHtml(r, page);
    else if (kind === 'families') body = familiesIndexHtml(r, page);
    else if (kind === 'surnames') body = surnamesIndexHtml(r);
    else body = placesIndexHtml(r, page);
    // A page of a split index carries its letter in the heading (1102 §7.4).
    return `<header class="sp-head"><h1 class="sp-h1">${esc(page.letter !== undefined ? page.title : F.index)}</h1></header>`
        + `<nav class="sp-tabs" aria-label="${esc(F.idxNav)}">${tabs}</nav><div class="sp-ix sp-ix--${kind}">${body}</div>`;
}

// ─── The map of places (§3.7) ───────────────────────────────────────────────

interface SetMap {
    points: RodPlacePoint[];
    byKey: Map<string, RodPlacePoint>;
    geo: Record<string, PlaceGeo>;
    /** The set asks for the map and its places make one (two places or more with a position, not all within 3 km). */
    drawn: boolean;
}

const setMaps = new WeakMap<PageSet, SetMap>();

/** The map's places, once per set: the own events of the people with a page, no protected living (§5). */
function setMap(set: PageSet): SetMap {
    let m = setMaps.get(set);
    if (m) return m;
    const prot = set.protectedTree;
    const tree = prot.tree;
    const points = collectRodPlacePoints(tree, set.selection.personIds.filter(id => set.personSlug.has(id)), {
        hidden: id => isProtectedPerson(prot, id), unionIds: set.selection.familyIds,
    });
    const geo: Record<string, PlaceGeo> = {};
    for (const p of points) {
        const g = tree.places?.[p.placeKey];
        if (g) geo[p.placeKey] = { lat: g.lat, lon: g.lon };
    }
    const drawn = !!set.mapSlug && planPlacesMap(points, geo, { kidPlaces: false, lang: set.options.lang }).state === 'map';
    m = { points, byKey: new Map(points.map(p => [p.placeKey, p])), geo, drawn };
    setMaps.set(set, m);
    return m;
}

/**
 * Map of places (§3.7): the places where the line's people lived, a point
 * about the square root of its people; a click selects the place and its row
 * under the map unfolds its people (the person page's map and its script).
 */
function mapPageHtml(r: Render, page: SetPage): string {
    const F = r.S.familyPages;
    const m = setMap(r.set);
    const tree = r.set.protectedTree.tree;
    const row = (key: string): string => {
        const p = m.byKey.get(key);
        if (!p) return '';
        const people = p.personIds.map(pid => {
            const x = tree.persons[pid];
            const y = x ? bookYears(x) : '';
            return `<span class="sp-map-who">${personNameLink(r, pid, esc(x ? shownNameOrEmpty(x) || '?' : '?'))}${y ? ` <span class="sp-ix-y">${esc(y)}</span>` : ''}${livingTagHtml(r, pid)}</span>`;
        }).join('');
        const period = p.from === p.to ? String(p.from) : `${p.from}–${p.to}`;
        return ` · <span class="pp-map-ev">${esc(period)} · ${esc(F.nPersons(p.personIds.length))}</span><span class="sp-map-people">${people}</span>`;
    };
    const map = placesMapHtml(m.points, m.geo, {
        lang: r.set.options.lang, mode: r.mode, kidPlaces: false, id: `${page.slug}--pp-sec-places`,
        group: { title: '', size: key => rodPlacePointSize(m.byKey.get(key)?.personIds.length ?? 1), row },
    });
    return `<header class="sp-head"><h1 class="sp-h1">${esc(F.map)}</h1></header>${map}<p class="sp-map-note">${esc(F.mapNote)}</p>`;
}

// ─── The timeline of a line (1102 §5) ────────────────────────────────────────

/** A bar or band of the overview, placed on the whole axis (the script moves it on a zoom). */
function tlBarHtml(cls: string, from: number, to: number, a: number, b: number, title: string): string {
    const span = b - a;
    const x = Math.max(from, a), y = Math.min(to, b);
    const left = ((x - a) / span * 100).toFixed(2), width = (Math.max(y - x, 0.5) / span * 100).toFixed(2);
    return `<span class="${cls}" data-f="${from}" data-t="${to}" style="left:${left}%;width:${width}%" title="${esc(title)}"></span>`;
}

function tlTicksHtml(a: number, b: number): string {
    return rodTimelineTicks(a, b).map(y => `<span style="left:${((y - a) / (b - a) * 100).toFixed(2)}%">${y}</span>`).join('');
}

/** One event's row (§5.2): the year, the line with its dot, the kind, the person and the text. */
function tlRowHtml(r: Render, ctx: BookCtx, e: RodTimelineEvent): string {
    const F = r.S.familyPages;
    const chip = rodTimelineChip(e.kind);
    if (e.kind === 'history' && e.history) {
        const h = e.history;
        const kind = r.S.history.kinds[h.kind] ?? h.kind;
        const years = h.to ? ` (${h.from}–${h.to})` : '';
        const lang = h.textLang && h.textLang !== r.set.options.lang ? ` lang="${esc(h.textLang)}"` : '';
        const where = h.place ? ` <span class="sp-tl-pl">· ${esc(h.place)}</span>` : '';
        return `<li class="sp-tl-row sp-tl-row--hist" data-k="hist"><span class="sp-tl-y">${e.year}</span>`
            + `<div class="sp-tl-b"><span class="sp-tl-k">${esc(F.tlHist(kind))}</span><span class="sp-tl-t"><span${lang}>${esc(h.text)}</span>${esc(years)}${where}</span></div></li>`;
    }
    const who = e.personId ? personLinkHtml(r, ctx, e.personId) : '';
    const parts: string[] = [];
    if (e.kind === 'marriage') {
        let t = `⚭ ${e.partnerId ? personLinkHtml(r, ctx, e.partnerId) : '?'}`;
        if (e.place) t += `, ${esc(e.place)}`;
        parts.push(t);
        if (e.rod) {
            const label = rodLabel(r, ctx, e.rod.id);
            parts.push(rodLinkHtml(r, e.rod.id, esc(e.rod.rel === 'birth' ? F.birthRod(label) : F.toRod(label))));
        }
    } else if (e.kind === 'move' || e.kind === 'emigration') {
        // An emigration record without a known destination has only the place left.
        parts.push(e.from && e.place ? `${esc(e.from)} → ${esc(e.place)}` : e.from ? esc(F.tlLeft(e.from)) : `→ ${esc(e.place ?? '')}`);
    } else {
        const t = [e.place ? esc(e.place) : '', e.kind === 'death' && e.age !== undefined ? esc(r.S.history.age(String(e.age))) : ''].filter(Boolean).join(', ');
        if (t) parts.push(t);
    }
    const text = parts.join(' · ');
    return `<li class="sp-tl-row" data-k="${chip}"><span class="sp-tl-y">${e.year}</span>`
        + `<div class="sp-tl-b"><span class="sp-tl-k">${esc(F.tlEv[e.kind as Exclude<RodTimelineKind, 'history'>])}</span>`
        + `<span class="sp-tl-t">${who}${who && text ? (e.kind === 'marriage' ? ' ' : ', ') : ''}${text}</span></div></li>`;
}

/** The page "Timeline of the line" (§5.2): the header, the controls (with the script), the overview and the events by century. */
function rodTimelinePageHtml(r: Render, page: SetPage, ctx: BookCtx): string {
    const { set, S } = r;
    const F = S.familyPages;
    const rod = rodOf(r, page.id);
    if (!rod) return '';
    const tl = buildRodTimeline({
        prot: set.protectedTree, rodId: rod.id, lang: set.options.lang, now: set.options.now,
        history: set.history, historyOn: set.options.groups.history,
    });
    if (!tl) return '';
    const hist = tl.events.filter(e => e.kind === 'history' && e.history);
    const meta = [
        tl.period ? (tl.period.from === tl.period.to ? String(tl.period.from) : `${tl.period.from}–${tl.period.to}`) : '',
        tl.generations.length ? F.nGens(tl.generations.length) : '', F.tlCount(tl.events.length), F.nMembers(rod.realMemberCount),
    ].filter(Boolean).join(' · ');
    const head = `<header class="sp-head"><div class="sp-kicker">${esc(F.tlKicker)}</div><h1 class="sp-h1">${esc(page.title)}</h1><p class="sp-sub">${esc(meta)}</p></header>`;
    if (!tl.events.length) return `${head}<p class="sp-faint">${esc(F.tlNone)}</p>`;

    // The controls (§5.2): the centuries with events (two or more) and the kinds of events; the script's.
    const main = rodTimelineMainCentury(tl);
    const seg = tl.centuries.length > 1
        ? `<div class="sp-sort sp-tl-seg" role="radiogroup" aria-label="${esc(F.tlCentLabel)}">`
            + `<button type="button" role="radio" data-tl-c="" aria-checked="true">${esc(F.tlAll)}</button>`
            + tl.centuries.map(c => `<button type="button" role="radio" data-tl-c="${c.c}" aria-checked="false">${esc(F.tlCenturyShort(c.c))}</button>`).join('')
            + `</div>` : '';
    const kinds = ROD_TIMELINE_CHIPS.filter(k => k !== 'hist' || tl.history);
    const chips = `<div class="sp-tl-chips" role="group" aria-label="${esc(F.tlKindsLabel)}">`
        + kinds.map(k => `<button type="button" class="sp-tl-chip" data-tl-k="${k}" aria-pressed="true"><span class="sp-tl-dot" aria-hidden="true"></span>${esc(F.tlKinds[k])}</button>`).join('')
        + `</div>`;
    const controls = `<div class="sp-tl-ctl js-only">${seg}${chips}</div>`;

    // The overview (§5.2): generations, places, history as vertical bands; no bars of single people.
    const ends: number[] = [];
    for (const g of tl.generations) ends.push(g.from, g.to);
    for (const p of tl.places) ends.push(p.from, p.to);
    if (tl.period) ends.push(tl.period.from, tl.period.to);
    const { a, b } = rodTimelineAxis(Math.min(...ends), Math.max(...ends));
    const labels: string[] = ['<span class="sp-tl-lab sp-tl-lab--ax" aria-hidden="true"></span>'];
    const rows: string[] = [];
    for (const g of tl.generations) {
        labels.push(`<span class="sp-tl-lab sp-tl-lab--gen">${roman(g.gen)}<span class="sp-tl-lab-n"> · ${g.count}</span></span>`);
        rows.push(`<span class="sp-tl-r">${tlBarHtml('sp-tl-bar sp-tl-bar--gen', g.from, g.to, a, b, `${roman(g.gen)} · ${g.from}–${g.to}`)}</span>`);
    }
    tl.places.forEach((p, i) => {
        const first = i === 0 ? ' sp-tl-first' : '';
        labels.push(`<span class="sp-tl-lab sp-tl-lab--pl${first}" title="${esc(p.name)}"><span class="sp-tl-pln">${esc(p.name)}</span></span>`);
        rows.push(`<span class="sp-tl-r sp-tl-r--pl${first}">${tlBarHtml('sp-tl-bar sp-tl-bar--pl', p.from, p.to, a, b, `${p.name} · ${p.from}–${p.to}`)}</span>`);
    });
    const bands = hist.map(e => {
        const h = e.history!;
        return tlBarHtml('sp-tl-band', h.from, (h.to ?? h.from) + 1, a, b, `${h.text} (${h.to ? `${h.from}–${h.to}` : h.from})`);
    }).join('');
    const more = tl.morePlaces ? `<p class="sp-faint sp-more">${esc(F.morePlaces(tl.morePlaces))}</p>` : '';
    const note = bands ? `<p class="sp-tl-note">${esc(F.tlHistNote)}</p>` : '';
    const overview = `<section class="sp-block sp-tl-over"><h2 class="sp-h2">${esc(F.tlOverview)}</h2>`
        + `<div class="sp-tl-chart"><div class="sp-tl-labs">${labels.join('')}</div>`
        + `<div class="sp-tl-plot">${bands}<span class="sp-tl-ticks" aria-hidden="true">${tlTicksHtml(a, b)}</span>${rows.join('')}</div></div>${more}${note}</section>`;

    // The events by century (§5.2): every century open without the script; the script keeps the main one.
    const byC = new Map<number, RodTimelineEvent[]>();
    for (const e of tl.events) {
        const c = Math.floor(e.year / 100) + 1;
        const list = byC.get(c);
        if (list) list.push(e); else byC.set(c, [e]);
    }
    const groups = tl.centuries.map(c => `<details class="sp-tl-c" data-c="${c.c}" open><summary><span class="sp-tl-cn">${esc(F.tlCentury(c.c))}</span>`
        + `<span class="sp-tl-cc">${esc(F.tlCount(c.count))}</span></summary><ol class="sp-tl-rows">${(byC.get(c.c) ?? []).map(e => tlRowHtml(r, ctx, e)).join('')}</ol></details>`).join('');
    const events = `<section class="sp-block sp-tl-ev"><h2 class="sp-h2">${esc(F.tlEvents)}</h2>${groups}</section>`;
    return `${head}<div class="sp-tl" data-a="${a}" data-b="${b}" data-main="${main ?? ''}">${controls}${overview}${events}</div>`;
}

/** The pages drawn: every page, the map when its places make one. */
function rendered(set: PageSet, page: SetPage): boolean {
    if (page.kind === 'map') return setMap(set).drawn;
    return true;
}

/** The pages of the file, in its order (those drawn). */
export function pageSetRenderedPages(set: PageSet): SetPage[] {
    return set.pages.filter(p => rendered(set, p));
}

function personPageOpts(r: Render, page: SetPage): PersonPageOptions {
    const set = r.set;
    return {
        personId: page.id as PersonId, lang: set.options.lang, mode: r.mode,
        groups: {
            ...PERSON_PAGE_ALL_GROUPS, research: false, sources: set.options.sources,
            // The dialog's "Person pages" (1102 §4.4); stories are the protected copy's (buildPageSet).
            history: set.options.groups.history, childEvents: set.options.groups.childEvents,
            materials: set.options.groups.materials, pdf: set.options.groups.pdf,
            ...(r.opts.groups ?? {}),
        },
        privacy: set.options.privacy, toggles: { history: true, childEvents: true }, research: false,
        now: set.options.now, toc: false,
        links: {
            mode: 'set', personSlug: set.personSlug, familySlug: set.familySlug, rodSlug: set.rodSlug,
            // The whole tree: a small line's row leads to its block on "Other families" (spec 026 P3 §2.2).
            ...(set.otherAnchor.size && drawnSlug(r, set.otherSlug) ? { rodAnchor: set.otherAnchor, rodAnchorLabel: r.S.familyPages.otherRow } : {}),
        },
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
    else if (page.kind === 'persons') body = personsHubHtml(r, page, ctx);
    else if (page.kind === 'ancestors') body = ancestorsPageHtml(r, page, ctx);
    else if (page.kind === 'tree') body = treeHubHtml(r, page, ctx);
    else if (page.kind === 'other') body = otherFamiliesHtml(r, page);
    else if (page.kind === 'family') body = familyPageHtml(r, page, ctx);
    else if (page.kind === 'index') body = indexPageHtml(r, page);
    else if (page.kind === 'map') body = mapPageHtml(r, page);
    else if (page.kind === 'rodTimeline') body = rodTimelinePageHtml(r, page, ctx);
    return `${crumbs}<div class="sp-body">${body}</div>${r.foot}`;
}

function sectionHtml(r: Render, page: SetPage): string {
    const intro = page.slug === r.set.introSlug ? ' data-sp-intro' : '';
    // The whole tree: the line the bar's choice shows on this page (§2.3).
    const under = r.set.spec.kind === 'tree' ? ` data-sp-under="${esc(page.under ?? '')}"` : '';
    return `<section class="sp-page sp-page--${page.kind}" id="${esc(page.slug)}" data-sp-title="${esc(page.title)}"${intro}${under}>`
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
    row(F.tocRods, pages.filter(p => (p.kind === 'rod' || p.kind === 'other' || p.kind === 'rodTimeline') && p.slug !== r.set.introSlug));
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
    if (!page || !rendered(set, page)) return '';
    return sectionHtml(makeRender(set, 'app', opts), page);
}

/** The window's renderer of a set and its last pages (spec 026 P3 §3.3). */
interface WindowPages { r: Render; html: Map<string, string> }
const windowPages = new WeakMap<PageSet, WindowPages>();
/** Pages the window keeps drawn (the most recent ones). */
export const RENDER_PAGE_CACHE = 50;

function windowRender(set: PageSet): WindowPages {
    let w = windowPages.get(set);
    if (!w) { w = { r: makeRender(set, 'app', {}), html: new Map() }; windowPages.set(set, w); }
    return w;
}

/**
 * A page of the app's window drawn when it is opened (§3.3): the set's
 * renderer once per set, the last RENDER_PAGE_CACHE pages kept; '' for a
 * slug the set does not draw.
 */
export function renderPage(set: PageSet, slug: string): string {
    const w = windowRender(set);
    const hit = w.html.get(slug);
    if (hit !== undefined) {
        w.html.delete(slug);
        w.html.set(slug, hit);
        return hit;
    }
    const page = set.bySlug.get(slug);
    if (!page || !rendered(set, page)) return '';
    const html = sectionHtml(w.r, page);
    w.html.set(slug, html);
    if (w.html.size > RENDER_PAGE_CACHE) w.html.delete(w.html.keys().next().value!);
    return html;
}

/** The window's bar of a page (the window's renderer). */
export function renderPageBar(set: PageSet, slug: string): string {
    return barHtml(windowRender(set).r, set.bySlug.get(slug) ?? null);
}

/** The window's search results (the window's renderer). */
export function renderPageSearch(set: PageSet, query: string): string {
    return searchHtml(windowRender(set).r, query);
}

// ─── The set of files (§6.4, 1102 §7.5) ─────────────────────────────────

/** The way up from a file of the set to its root: '' for index.html, '../' from a folder. */
function rootOf(path: string): string {
    return '../'.repeat(path.split('/').length - 1);
}

const IMAGE_EXT: Record<string, string> = {
    'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/svg+xml': 'svg',
};

/**
 * A page's links in the set of files: `#slug` of another page becomes the
 * relative path of its file (`../osoby/x.html`, the introduction
 * `../index.html`), `#slug--x` the file with the anchor, a link inside the
 * page stays; a place of a lineage's header leads to the map with the place
 * selected (`../rejstrik/mapa-obci.html#mapa-obci--m-{key}`).
 */
function zipLinks(set: PageSet, own: string, root: string, drawn: ReadonlySet<string>, html: string): string {
    return html
        .replace(/href="#([^"]+)" data-sp-place="([^"]*)"/g, (all, id: string, key: string) =>
            set.bySlug.get(id)?.kind === 'map' && drawn.has(id) ? `href="#${id}--m-${encodeURIComponent(key)}" data-sp-place="${key}"` : all)
        .replace(/href="#([^"]+)"/g, (all, id: string) => {
            const i = id.indexOf('--');
            const slug = i > 0 ? id.slice(0, i) : id;
            if (!drawn.has(slug) || slug === own) return all;
            return `href="${root}${pageSetPath(set, slug)}${slug === id ? '' : `#${id}`}"`;
        });
}

/** One file of the set: the shared styles and scripts by reference, the bar, the page. */
function zipPageShell(r: Render, page: SetPage, body: string): string {
    const lang = r.set.options.lang;
    const files = `${r.root ?? ''}${pageSetFolders(r.set).files}`;
    // A whole tree's file keeps its bar without the script: the choice of a line works as a plain `<details>` (§2.3).
    const zipCls = r.set.spec.kind === 'tree' ? ' sp-zip' : '';
    return `<!doctype html><html lang="${esc(lang)}" class="no-js${zipCls}"><head>`
        + `<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">`
        + `<meta name="generator" content="Strom"><title>${esc(page.title)}</title>`
        + `<link rel="stylesheet" href="${files}/styl.css"></head><body><script>document.documentElement.className='js${zipCls}'</script>`
        + barHtml(r, page) + `<main class="pp-file sp-file">${body}</main>`
        + `<script type="application/json" id="sp-strings">${jsonForScript(searchStrings(r))}</script>`
        + `<script src="${files}/hledani.js"></script><script src="${files}/skript.js"></script></body></html>`;
}

/**
 * The set of files (§6.4, 1102 §7.5), a page at a time: `index.html` (the
 * introduction and the contents) at the top, every other page in its folder
 * (pageSetPath), the images in the images' folder, the shared `styl.css`,
 * `skript.js` and the search index `hledani.js` (`window.__spIndex`: a page
 * opened from a folder over file:// cannot fetch a JSON file) in the files'
 * folder. Links are relative: it works offline from the unpacked folder and
 * as it is on a web server. With `emit` every file goes there as soon as it is
 * written (the zip's stream) and the result is empty; else the files in order.
 */
export async function buildPageSetFilesAsync(set: PageSet, opts: PageSetHtmlOptions & {
    pause?: () => Promise<void>;
    progress?: (done: number, total: number) => void;
    emit?: (entry: ZipEntry) => void | Promise<void>;
} = {}): Promise<ZipEntry[]> {
    const r = makeRender(set, 'file', opts);
    r.zip = true;
    const pages = pageSetRenderedPages(set);
    const drawn = new Set(pages.map(p => p.slug));
    const out: ZipEntry[] = [];
    const emit = async (e: ZipEntry): Promise<void> => { if (opts.emit) await opts.emit(e); else out.push(e); };
    const folders = pageSetFolders(set);
    const results = `<div class="sp-results" id="sp-results" aria-live="polite" hidden></div>`;
    const foot = `<p class="sp-print-foot">${esc(r.S.familyPages.printFoot('index.html'))}</p>`;
    let done = 0;
    // The introduction first: an unpacker lists index.html at the top.
    const ordered = [...pages.filter(p => p.slug === set.introSlug), ...pages.filter(p => p.slug !== set.introSlug)];
    for (const p of ordered) {
        const path = pageSetPath(set, p.slug);
        r.root = rootOf(path);
        const toc = p.slug === set.introSlug ? fileTocHtml(r, pages) : '';
        const html = zipPageShell(r, p, `${toc}${results}${sectionHtml(r, p)}${foot}`);
        await emit({ path, data: zipLinks(set, p.slug, r.root, drawn, html) });
        opts.progress?.(++done, pages.length);
        if (opts.pause) await opts.pause();
    }
    // Last: every image of every page is in the registry by now.
    const files = new Map<number, string>();
    for (const e of set.images.entries()) {
        const img = dataUrlBytes(e.src);
        if (!img) continue;
        const path = `${folders.images}/img-${e.n}.${IMAGE_EXT[img.mime] ?? 'bin'}`;
        files.set(e.n, path);
        await emit({ path, data: img.bytes });
    }
    // The styles live in the files' folder: an image is one folder up.
    const css = `${personPageFileCss(opts.fontCss ?? '')}${FAMILY_PAGES_CSS}\n`
        + set.images.css(n => files.has(n) ? `../${files.get(n)}` : '');
    await emit({ path: `${folders.files}/styl.css`, data: css });
    await emit({ path: `${folders.files}/skript.js`, data: [PERSON_PAGE_SCRIPT, PERSON_PAGE_STORY_SCRIPT, PLACES_MAP_SCRIPT, fanZoomInlineScript(), PAGE_SET_SCRIPT].join(';\n') });
    await emit({ path: `${folders.files}/hledani.js`, data: `window.__spIndex=${jsonForScript(set.searchIndex)};\n` });
    return out;
}

/** The name of the set of files: the file's name with .zip (`Rod-Fisek.zip`). */
export function pageSetZipName(set: PageSet): string {
    return pageSetFileName(set).replace(/\.html$/, '') + '.zip';
}
