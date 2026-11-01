/**
 * The family pages (spec 026): one linked file of pages for a lineage, a few
 * lineages or a branch: an introduction, the lineages, the families, the
 * people, the indexes and the map of places. This module is the set's model,
 * pure and DOM-free: which pages there are and in which order, their slugs,
 * titles and breadcrumbs, the protection of the living (once for the whole
 * set), the search index, the file name and the size estimate. Rendering the
 * pages is the blocks' (person-page.ts, book-blocks.ts) and the set file's.
 *
 * Everything here reads the protected tree only: a protected person has no
 * page, no slug and no link, and is in the search index by the protected name.
 */

import { Partnership, PartnershipId, Person, PersonId, StromData, personSourceIds } from './types.js';
import { PrivacyMode } from './privacy.js';
import { getStringsForLang, Language } from './strings.js';
import { yearOf } from './dates.js';
import { shownNameOrEmpty } from './person-name.js';
import { feminineForm } from './surnames.js';
import { asciiSlug } from './filenames.js';
import { normalizeSearchText, searchableSurnames, alternateNames } from './name-search.js';
import { LineageIndex, Rod, RodId, Selection, rodGenerations, rodNameForms, selection } from './lineage.js';
import { BookSelectionSpec, chapterRods, lineageSpec } from './book-model.js';
import { PERSON_PAGE_DEFAULT_PRIVACY, ProtectedPersonPageTree, dataUrlImageSize, personPageFileName, protectPersonPageTree } from './person-page.js';
import { ImageChoice, ImageRegistry, RegistryImageKind, SHRINK_CLIP_PX, SHRINK_PHOTO_PX } from './image-registry.js';

export type PageKind = 'hub' | 'rod' | 'branch' | 'family' | 'person' | 'index' | 'map' | 'tree';

/** The four indexes (spec 026 §3.5). */
export type PageSetIndexKind = 'persons' | 'families' | 'surnames' | 'places';

export interface PageCrumb { slug: string; label: string }

export interface SetPage {
    slug: string;
    kind: PageKind;
    /**
     * What the page is about: a lineage's id ('rod'), a union's ('family'), a
     * person's ('person', and 'branch': the ancestor), the index's kind
     * ('index'); none for the hub, the tree and the map.
     */
    id?: string;
    /** Plain text (not escaped). */
    title: string;
    /** Where the page stands in the set (§3.2), the page itself last; [] for the introduction. */
    crumbs: PageCrumb[];
}

/** One person of the search index (§0.7); a protected person: `s` '', `n` and `k` from the protected name only. */
export interface SearchEntry {
    /** The person's page ('' without one). */
    s: string;
    /** The shown name. */
    n: string;
    /** "1820–1894", "* 1952" or ''. */
    y: string;
    /** "Fíšek family line, generation VI · recorded as Fischek" / "wife in the Fíšek family line" or ''. */
    t: string;
    /** Normalized search keys, space-separated, each once. */
    k: string;
}

export interface PageSetOptions {
    lang: Language;
    /** Protection of the living (§5), default PERSON_PAGE_DEFAULT_PRIVACY. */
    privacy?: PrivacyMode;
    /** Families as pages of their own where it makes sense (default) or only as a section of the person page (§2.1). */
    families?: 'pages' | 'section';
    /** Record excerpts and photos: as they are (default), reduced, none (§6.2). */
    clips?: ImageChoice;
    photos?: ImageChoice;
    /** The map of places as a page (default true). */
    map?: boolean;
    /** The person pages' sources (default true). */
    sources?: boolean;
    /** The stories of persons and couples (default true). */
    stories?: boolean;
    now?: Date;
}

export interface PageSetContext {
    /** A reduced copy of an image for 'small' (made beforehand: the canvas is asynchronous). */
    replaceImage?: (dataUrl: string, kind: RegistryImageKind) => string | null;
    /** An image's size in pixels (the aspect ratio of its box); default: read from the JPEG / PNG header. */
    imageSize?: (dataUrl: string) => { w: number; h: number } | null;
    /** The tree's name, the introduction's title of a set of the whole tree. */
    treeName?: string;
}

export interface PageSet {
    spec: BookSelectionSpec;
    options: Required<Pick<PageSetOptions, 'lang' | 'privacy' | 'families' | 'clips' | 'photos' | 'map' | 'sources' | 'stories'>> & { now: Date };
    selection: Selection;
    protectedTree: ProtectedPersonPageTree;
    /** The lineages with a page, in reading order. */
    rodIds: RodId[];
    /** The lineage labels as the set writes them (a living founder's lineage protected, §5). */
    rodLabels: ReadonlyMap<RodId, string>;
    pages: SetPage[];
    bySlug: Map<string, SetPage>;
    personSlug: Map<PersonId, string>;
    familySlug: Map<PartnershipId, string>;
    rodSlug: Map<RodId, string>;
    /** Slugs of the indexes and of the map ('' for a page the set does not have). */
    indexSlug: Record<PageSetIndexKind, string>;
    mapSlug: string;
    /** The introduction's slug: the hub, the single lineage or the branch. */
    introSlug: string;
    images: ImageRegistry;
    searchIndex: SearchEntry[];
}

/** Fixed slugs (§0.6): the same in every language, stable between saves. */
export const PAGE_SET_HUB_SLUG = 'uvod';
export const PAGE_SET_INDEX_SLUGS: Record<PageSetIndexKind, string> = {
    persons: 'rejstrik-osoby', families: 'rejstrik-rodiny', surnames: 'rejstrik-prijmeni', places: 'rejstrik-obce',
};
export const PAGE_SET_MAP_SLUG = 'mapa-obci';

/**
 * A slug not used yet: `base`, else `base-2`, `base-3`… (§0.6); the result
 * is added to `used`. Given in page order, so the same choice keeps its slugs.
 */
export function uniqueSlug(base: string, used: Set<string>): string {
    const b = base || 'stranka';
    let slug = b;
    for (let n = 2; used.has(slug); n++) slug = `${b}-${n}`;
    used.add(slug);
    return slug;
}

function genderKey(p: Person | undefined): 'm' | 'f' | 'u' {
    return p?.gender === 'male' ? 'm' : p?.gender === 'female' ? 'f' : 'u';
}

/** A living person under a privacy other than full: no page, no slug, no link (§5). */
export function isProtectedPerson(prot: ProtectedPersonPageTree, id: PersonId): boolean {
    return prot.privacy !== 'full' && prot.living.has(id);
}

function realPerson(tree: StromData, id: PersonId | undefined | null): Person | undefined {
    const p = id ? tree.persons[id] : undefined;
    return p && !p.isPlaceholder ? p : undefined;
}

/** The union's partners, husband first (as the book's heading), real people only. */
function partnersOf(tree: StromData, u: Partnership): Person[] {
    const out = [u.person1Id, u.person2Id].map(id => realPerson(tree, id)).filter((p): p is Person => !!p);
    return out.sort((a, b) => (a.gender === 'female' ? 1 : 0) - (b.gender === 'female' ? 1 : 0));
}

/** A recorded marriage (not a partnership without one). */
function isMarriage(u: Partnership): boolean {
    return u.status === 'married' || u.status === 'divorced';
}

/**
 * Does a union get a page of its own (§2.1)? With families as pages, both
 * partners recorded, a marriage or at least one child, and not both partners
 * protected living people. Otherwise it is a section of the person page.
 */
export function familyHasPage(u: Partnership, set: { protectedTree: ProtectedPersonPageTree }, opts: { families?: 'pages' | 'section' } = {}): boolean {
    if ((opts.families ?? 'pages') !== 'pages') return false;
    const prot = set.protectedTree;
    const ps = partnersOf(prot.tree, u);
    if (ps.length < 2) return false;
    if (!isMarriage(u) && !(u.childIds ?? []).some(id => !!prot.tree.persons[id])) return false;
    return !ps.every(p => isProtectedPerson(prot, p.id));
}

/**
 * Does a union have a page in the app's window (§7: the person card's menu,
 * the person page's "Family page →")? Full data there, families as pages: both
 * partners recorded, a marriage or a child, and a partner's lineage carries
 * the union (its set is where the window opens the page).
 */
export function familyHasWindowPage(data: StromData, index: LineageIndex, u: Partnership): boolean {
    if (partnersOf(data, u).length < 2) return false;
    if (!isMarriage(u) && !(u.childIds ?? []).some(id => !!data.persons[id])) return false;
    return [u.person1Id, u.person2Id].some(pid => {
        const rodId = pid ? index.rodByPerson.get(pid) : undefined;
        return !!rodId && !!index.rods.get(rodId)?.familyIds.includes(u.id);
    });
}

/** A person's unions and the parents' union that have a page in the window (see familyHasWindowPage). */
export function windowFamilyPages(data: StromData, index: LineageIndex, personId: PersonId): Set<PartnershipId> {
    const out = new Set<PartnershipId>();
    const p = data.persons[personId];
    if (!p) return out;
    const unions = new Set<PartnershipId>(p.partnerships);
    for (const par of p.parentIds ?? []) {
        for (const uid of data.persons[par]?.partnerships ?? []) if (data.partnerships[uid]?.childIds.includes(personId)) unions.add(uid);
    }
    for (const uid of unions) {
        const u = data.partnerships[uid];
        if (u && familyHasWindowPage(data, index, u)) out.add(uid);
    }
    return out;
}

function nameOf(tree: StromData, id: PersonId): string {
    const p = tree.persons[id];
    return p ? shownNameOrEmpty(p) || '?' : '?';
}

/** "Josef and Anna": the first names, husband first (§3.2), plain text. */
export function familyFirstNames(tree: StromData, u: Partnership, lang: Language): string {
    const and = getStringsForLang(lang).book.and;
    const ps = partnersOf(tree, u);
    return ps.length ? ps.map(p => p.firstName?.trim() || p.lastName?.trim() || '?').join(` ${and} `) : '?';
}

/** "Josef Fíšek and Anna Kvapilová": the family page's title (§2.1), plain text. */
export function familyTitle(tree: StromData, u: Partnership, lang: Language): string {
    const and = getStringsForLang(lang).book.and;
    const ps = partnersOf(tree, u);
    return ps.length ? ps.map(p => shownNameOrEmpty(p) || '?').join(` ${and} `) : '?';
}

/** "1820–1894", "* 1952", "† 1890" or '' (from the protected tree). */
function yearsOf(p: Person | undefined): string {
    if (!p) return '';
    const b = yearOf(p.birthDate), d = yearOf(p.deathDate);
    if (b !== null && d !== null) return `${b}–${d}`;
    if (b !== null) return `* ${b}`;
    if (d !== null) return `† ${d}`;
    return '';
}

function roman(n: number): string {
    const map: [number, string][] = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
    let out = '';
    let v = Math.max(1, Math.floor(n));
    for (const [k, s] of map) while (v >= k) { out += s; v -= k; }
    return out;
}

/**
 * A lineage's label as the set writes it (§5): the founder a protected
 * living person, the surname only (under hidden names '' — the generic
 * "Family line"); otherwise the lineage label ("Lhoták (Čapkov)").
 */
function setRodLabel(prot: ProtectedPersonPageTree, rod: Rod): string {
    const label = prot.rodLabels.get(rod.id) ?? rod.surname;
    if (!prot.living.has(rod.founderId) || prot.privacy === 'full' || prot.privacy === 'minimal') return label;
    return prot.privacy === 'anonymous' ? '' : rod.surname;
}

function rodTitleOf(lang: Language, label: string): string {
    const F = getStringsForLang(lang).familyPages;
    return label ? F.rodTitle(label) : F.rodGeneric;
}

/** The set's lineages: chosen ones; for the whole tree those the book tells as chapters; none for a branch. */
function setRods(prot: ProtectedPersonPageTree, spec: BookSelectionSpec): Rod[] {
    const index = prot.lineages;
    if (spec.kind === 'rods') return spec.rods.map(id => index.rods.get(id)).filter((r): r is Rod => !!r);
    if (spec.kind === 'tree') return chapterRods(index);
    return [];
}

/** A member's generation within its lineage (I = the root). */
function generationMap(prot: ProtectedPersonPageTree, rods: readonly Rod[]): Map<PersonId, number> {
    const out = new Map<PersonId, number>();
    for (const rod of rods) {
        rodGenerations(prot.lineages, rod.id).forEach((ids, i) => { for (const id of ids) if (!out.has(id)) out.set(id, i + 1); });
    }
    return out;
}

/**
 * Builds the set (§0.1): protection once for all pages, the selection the
 * book uses, the pages in file order — the introduction (hub / lineage /
 * branch / tree), the lineages, the families (in the selection's order), the
 * people (in the selection's order), the indexes and the map — with their
 * slugs and breadcrumbs, the shared image registry and the search index.
 */
export function buildPageSet(data: StromData, spec: BookSelectionSpec, opts: PageSetOptions, ctx: PageSetContext = {}): PageSet {
    const lang = opts.lang;
    const S = getStringsForLang(lang);
    const F = S.familyPages;
    const options: PageSet['options'] = {
        lang, privacy: opts.privacy ?? PERSON_PAGE_DEFAULT_PRIVACY, families: opts.families ?? 'pages',
        clips: opts.clips ?? 'full', photos: opts.photos ?? 'full', map: opts.map ?? true,
        sources: opts.sources ?? true, stories: opts.stories ?? true, now: opts.now ?? new Date(),
    };
    const prot = protectPersonPageTree(data, options.privacy, options.now);
    if (!options.stories) {
        // Without stories: the protected copy loses them (the tree itself is untouched).
        for (const [id, p] of Object.entries(prot.tree.persons)) if (p.story) prot.tree.persons[id as PersonId] = { ...p, story: undefined };
        const unions: StromData['partnerships'] = {};
        for (const [id, u] of Object.entries(prot.tree.partnerships)) unions[id as PartnershipId] = u.story ? { ...u, story: undefined } : u;
        prot.tree.partnerships = unions;
    }
    if (options.privacy === 'anonymous' || options.privacy === 'minimal') {
        // "Living person" in the file's language, not the app's (as the book does).
        for (const id of prot.living) { const p = prot.tree.persons[id]; if (p) p.firstName = S.privacy.livingPerson; }
    }
    const tree = prot.tree;
    const index = prot.lineages;
    const sel = selection(index, lineageSpec(spec));
    const rods = setRods(prot, spec);
    const rodIds = rods.map(r => r.id);
    const labels = new Map<RodId, string>(rods.map(r => [r.id, setRodLabel(prot, r)]));
    const inRods = new Set(rodIds);

    const used = new Set<string>();
    const pages: SetPage[] = [];
    const personSlug = new Map<PersonId, string>();
    const familySlug = new Map<PartnershipId, string>();
    const rodSlug = new Map<RodId, string>();

    // The introduction.
    let intro: SetPage;
    if (spec.kind === 'rods' && rods.length === 1) {
        const rod = rods[0];
        intro = { slug: uniqueSlug(`rod-${asciiSlug(labels.get(rod.id) ?? '') || 'rod'}`, used), kind: 'rod', id: rod.id, title: rodTitleOf(lang, labels.get(rod.id) ?? ''), crumbs: [] };
        rodSlug.set(rod.id, intro.slug);
    } else if (spec.kind === 'ancestors' || spec.kind === 'descendants') {
        const name = nameOf(tree, spec.person);
        const base = `${spec.kind === 'ancestors' ? 'predci' : 'potomci'}-${asciiSlug(name)}`;
        intro = {
            slug: uniqueSlug(base, used), kind: 'branch', id: spec.person,
            title: spec.kind === 'ancestors' ? S.book.titleAncestors(name) : S.book.titleDescendants(name), crumbs: [],
        };
    } else if (spec.kind === 'tree') {
        intro = { slug: uniqueSlug(PAGE_SET_HUB_SLUG, used), kind: 'tree', title: ctx.treeName?.trim() || S.book.title, crumbs: [] };
    } else {
        const named = rods.map(r => labels.get(r.id) ?? '').filter(Boolean);
        intro = { slug: uniqueSlug(PAGE_SET_HUB_SLUG, used), kind: 'hub', title: named.length ? F.hubTitle(named) : F.rodGeneric, crumbs: [] };
    }
    pages.push(intro);
    const introCrumb: PageCrumb = { slug: intro.slug, label: intro.kind === 'hub' || intro.kind === 'tree' ? F.hub : intro.title };

    // The lineages.
    for (const rod of rods) {
        if (rodSlug.has(rod.id)) continue;
        const label = labels.get(rod.id) ?? '';
        const slug = uniqueSlug(`rod-${asciiSlug(label) || 'rod'}`, used);
        rodSlug.set(rod.id, slug);
        const title = rodTitleOf(lang, label);
        pages.push({ slug, kind: 'rod', id: rod.id, title, crumbs: [introCrumb, { slug, label: title }] });
    }
    const rodCrumb = (rodId: RodId | null | undefined): PageCrumb => {
        const slug = rodId ? rodSlug.get(rodId) : undefined;
        if (!slug || !rodId) return introCrumb;
        return { slug, label: rodTitleOf(lang, labels.get(rodId) ?? '') };
    };
    const rodOfMember = (id: PersonId): RodId | null => {
        const r = index.rodByPerson.get(id) ?? null;
        return r && inRods.has(r) ? r : null;
    };
    const famRod = new Map<PartnershipId, RodId | null>();
    for (const rod of rods) for (const fid of rod.familyIds) if (!famRod.has(fid)) famRod.set(fid, rod.id);

    // The families.
    const set = { protectedTree: prot };
    const families: PartnershipId[] = [];
    for (const fid of sel.familyIds) {
        const u = tree.partnerships[fid];
        if (!u || !familyHasPage(u, set, options)) continue;
        const ps = partnersOf(tree, u);
        const year = isMarriage(u) ? yearOf(u.startDate) : null;
        const base = ['rodina', ...ps.map(p => asciiSlug(shownNameOrEmpty(p)) || 'x'), year !== null ? String(year) : ''].filter(Boolean).join('-');
        familySlug.set(fid, uniqueSlug(base, used));
        families.push(fid);
    }
    for (const fid of families) {
        const u = tree.partnerships[fid];
        const slug = familySlug.get(fid)!;
        const memberRod = famRod.get(fid) ?? partnersOf(tree, u).map(p => rodOfMember(p.id)).find(r => !!r) ?? null;
        pages.push({
            slug, kind: 'family', id: fid, title: familyTitle(tree, u, lang),
            crumbs: [rodCrumb(memberRod), { slug, label: familyFirstNames(tree, u, lang) }],
        });
    }

    // The people: members and married-in spouses, the protected left out.
    const spouses = new Set(sel.spouseIds);
    const withPage = sel.personIds.filter(id => !!realPerson(tree, id) && !isProtectedPerson(prot, id));
    for (const id of withPage) {
        personSlug.set(id, uniqueSlug(personPageFileName({ lang, tree, personId: id, privacy: prot.privacy, living: prot.living }).replace(/\.html$/, ''), used));
    }
    const famCrumb = (fid: PartnershipId | undefined): PageCrumb[] => {
        const slug = fid ? familySlug.get(fid) : undefined;
        return slug && fid ? [{ slug, label: familyFirstNames(tree, tree.partnerships[fid], lang) }] : [];
    };
    const unionsOf = (id: PersonId): Partnership[] => (tree.persons[id]?.partnerships ?? []).map(pid => tree.partnerships[pid]).filter((u): u is Partnership => !!u);
    for (const id of withPage) {
        const slug = personSlug.get(id)!;
        const self: PageCrumb = { slug, label: nameOf(tree, id) };
        let crumbs: PageCrumb[];
        if (spouses.has(id)) {
            // A married-in spouse: the spouse's lineage (or the own birth lineage in the file), the own family.
            const own = unionsOf(id).find(u => familySlug.has(u.id));
            const viaSpouse = own ? partnersOf(tree, own).map(p => rodOfMember(p.id)).find(r => !!r) : null;
            crumbs = [rodCrumb(viaSpouse ?? rodOfMember(id)), ...famCrumb(own?.id), self];
        } else {
            const parents = Object.values(tree.partnerships).find(u => u.childIds?.includes(id) && familySlug.has(u.id));
            crumbs = [rodCrumb(rodOfMember(id)), ...famCrumb(parents?.id), self];
        }
        pages.push({ slug, kind: 'person', id, title: nameOf(tree, id), crumbs });
    }

    // The indexes and the map.
    const indexSlug = {} as Record<PageSetIndexKind, string>;
    const startCrumb: PageCrumb = { slug: intro.slug, label: F.start };
    for (const k of ['persons', 'families', 'surnames', 'places'] as const) {
        const slug = uniqueSlug(PAGE_SET_INDEX_SLUGS[k], used);
        indexSlug[k] = slug;
        pages.push({ slug, kind: 'index', id: k, title: F.indexTitle[k], crumbs: [startCrumb, { slug, label: F.indexTitle[k] }] });
    }
    let mapSlug = '';
    if (options.map) {
        mapSlug = uniqueSlug(PAGE_SET_MAP_SLUG, used);
        pages.push({ slug: mapSlug, kind: 'map', title: F.map, crumbs: [startCrumb, { slug: mapSlug, label: F.map }] });
    }

    const images = new ImageRegistry({
        clips: options.clips, photos: options.photos,
        ...(ctx.replaceImage ? { replace: ctx.replaceImage } : {}),
        size: ctx.imageSize ?? dataUrlImageSize,
    });

    const out: PageSet = {
        spec, options, selection: sel, protectedTree: prot, rodIds, rodLabels: labels,
        pages, bySlug: new Map(pages.map(p => [p.slug, p])), personSlug, familySlug, rodSlug, indexSlug, mapSlug,
        introSlug: intro.slug, images, searchIndex: [],
    };
    out.searchIndex = buildSearchIndex(out, rods);
    return out;
}

/** The search index (§0.7) over the selection's people, in its order. */
function buildSearchIndex(set: PageSet, rods: readonly Rod[]): SearchEntry[] {
    const prot = set.protectedTree;
    const tree = prot.tree;
    const F = getStringsForLang(set.options.lang).familyPages;
    const gens = generationMap(prot, rods);
    const rodById = new Map(rods.map(r => [r.id, r]));
    const forms = new Map<RodId, string[]>();
    const formsOf = (rod: Rod): string[] => {
        let f = forms.get(rod.id);
        if (!f) { const nf = rodNameForms(rod, tree); f = [...nf.forms, ...nf.feminine]; forms.set(rod.id, f); }
        return f;
    };
    // A married-in spouse's lineage: the member's they married.
    const spouseRod = new Map<PersonId, RodId>();
    for (const rod of rods) for (const s of rod.spouses) if (!spouseRod.has(s.personId)) spouseRod.set(s.personId, rod.id);
    const memberSet = new Set(set.selection.memberIds);

    const out: SearchEntry[] = [];
    for (const id of set.selection.personIds) {
        const p = realPerson(tree, id);
        if (!p) continue;
        const n = shownNameOrEmpty(p) || '?';
        const keys: string[] = [];
        const add = (text: string): void => {
            for (const w of normalizeSearchText(text).split(' ')) if (w && !keys.includes(w)) keys.push(w);
        };
        add(n);
        if (isProtectedPerson(prot, id)) {
            out.push({ s: '', n, y: yearsOf(p), t: '', k: keys.join(' ') });
            continue;
        }
        searchableSurnames(p, tree).forEach(add);
        alternateNames(p, tree).forEach(add);
        let t = '';
        const memberRodId = memberSet.has(id) ? prot.lineages.rodByPerson.get(id) ?? null : null;
        const rod = memberRodId ? rodById.get(memberRodId) : undefined;
        if (rod) {
            formsOf(rod).forEach(add);
            const label = set.rodLabels.get(rod.id) || F.rodGeneric;
            t = F.tagRod(label, roman(gens.get(id) ?? 1));
            const last = p.lastName?.trim() ?? '';
            const canon = [rod.surname, feminineForm(rod.surname) ?? ''].filter(Boolean).map(normalizeSearchText);
            if (last && !canon.includes(normalizeSearchText(last))) t += ` · ${F.recordedAs[genderKey(p)](last)}`;
        } else {
            const sr = spouseRod.get(id);
            if (sr) t = F.spouseIn[genderKey(p)](set.rodLabels.get(sr) || F.rodGeneric);
        }
        out.push({ s: set.personSlug.get(id) ?? '', n, y: yearsOf(p), t, k: keys.join(' ') });
    }
    return out;
}

/** Living people of the selection (judged before protection), by the names the file would carry. */
export function pageSetLivingNames(set: PageSet): string[] {
    const tree = set.protectedTree.tree;
    return set.selection.personIds.filter(id => set.protectedTree.living.has(id) && !!realPerson(tree, id)).map(id => nameOf(tree, id));
}

/** The dialog's warning under full data (§5): '' when the selection has no living people or they are protected. */
export function pageSetPrivacyWarning(set: PageSet): string {
    if (set.options.privacy !== 'full') return '';
    const n = pageSetLivingNames(set).length;
    return n ? getStringsForLang(set.options.lang).familyPages.privacyWarn(n) : '';
}

/** "Rod Fíšek" → "Rod-Fisek": ASCII words, each keeping its first letter's case. */
function fileWords(text: string): string {
    return text.split(/[\s,:;/()·]+/).map(w => {
        const a = asciiSlug(w);
        if (!a) return '';
        return w.charAt(0) !== w.charAt(0).toLowerCase() ? a.charAt(0).toUpperCase() + a.slice(1) : a;
    }).filter(Boolean).join('-');
}

/**
 * The file's name (§6.3): from the choice, ASCII — "Rod-Fisek.html",
 * "Rody-Fisek-Kvapil-Repik.html", "Potomci-Josef-Fisek.html". Never a living
 * person's name: a branch of a living person is "Potomci.html", a lineage
 * whose founder is protected under hidden names "Rod.html".
 */
export function pageSetFileName(set: PageSet): string {
    const F = getStringsForLang(set.options.lang).familyPages;
    const intro = set.bySlug.get(set.introSlug);
    let stem = '';
    switch (set.spec.kind) {
        case 'rods': {
            const named = set.rodIds.map(id => set.rodLabels.get(id) ?? '').filter(Boolean);
            const S = getStringsForLang(set.options.lang).book;
            stem = named.length === 0 ? F.fileStem.rod : fileWords(named.length === 1 ? S.titleRod(named[0]) : S.titleRods(named));
            break;
        }
        case 'ancestors':
        case 'descendants':
            stem = set.protectedTree.living.has(set.spec.person) ? F.fileStem[set.spec.kind] : fileWords(intro?.title ?? '');
            break;
        case 'tree':
            stem = fileWords(intro?.title ?? '') || F.fileStem.tree;
            break;
    }
    return `${stem || F.fileStem.rod}.html`;
}

// ─── The size estimate (§6.3) ───────────────────────────────────────────────

/** Above this a single file is "large" (e-mail may refuse it), above the second it is saved as a set of files. */
export const PAGE_SET_BIG_BYTES = 15_000_000;
export const PAGE_SET_SPLIT_BYTES = 50_000_000;

export type PageSetSizeVerdict = 'ok' | 'big' | 'set';

export function sizeVerdict(bytes: number): PageSetSizeVerdict {
    return bytes > PAGE_SET_SPLIT_BYTES ? 'set' : bytes > PAGE_SET_BIG_BYTES ? 'big' : 'ok';
}

/** Text per page as the person page and the book's blocks write it (measured on sample trees, rounded up). */
const SHELL_BYTES = 110_000;          // styles, scripts, the bar
const PERSON_PAGE_BYTES = 24_000;
const FAMILY_PAGE_BYTES = 9_000;
const ROD_PAGE_BYTES = 8_000;
const ROD_ROW_BYTES = 450;            // one person of the lineage's generations
const INDEX_ROW_BYTES = 160;          // one row of an index
const SEARCH_ENTRY_BYTES = 120;
const MAP_PAGE_BYTES = 60_000;        // the outlines and the points
/** A reduced JPEG (quality 0.82) in base64: about 0.25 B per pixel × 4/3. */
const SMALL_BYTES_PER_PX = 0.34;
/** A reduced copy without a known size: a fraction of the original. */
const SMALL_UNKNOWN_RATIO = 0.35;

export interface PageSetImage { dataUrl: string; kind: RegistryImageKind; w?: number; h?: number }

/** The images the set's pages show, each once: portraits and image attachments (photos), excerpts of the cited sources (clips). */
export function pageSetImages(set: PageSet): PageSetImage[] {
    const tree = set.protectedTree.tree;
    const seen = new Set<string>();
    const out: PageSetImage[] = [];
    const add = (dataUrl: string | undefined, kind: RegistryImageKind, w?: number, h?: number): void => {
        const key = dataUrl?.replace(/\s+/g, '');
        if (!key || !key.startsWith('data:image/') || seen.has(key)) return;
        seen.add(key);
        out.push({ dataUrl: key, kind, ...(w && h ? { w, h } : {}) });
    };
    const sources = new Set<string>();
    for (const id of set.personSlug.keys()) {
        const p = tree.persons[id];
        if (!p) continue;
        add(p.photo, 'photo');
        for (const a of p.attachments ?? []) if (a.mimeType?.startsWith('image/')) add(a.dataUrl, 'photo');
        for (const s of personSourceIds(p)) sources.add(s);
        for (const uid of p.partnerships ?? []) for (const s of tree.partnerships[uid]?.sourceIds ?? []) sources.add(s);
    }
    for (const sid of sources) for (const x of tree.sources?.[sid]?.excerpts ?? []) add(x.dataUrl, 'clip', x.width, x.height);
    return out;
}

/** Bytes of one image in the file under a choice. */
function imageBytes(img: PageSetImage, choice: ImageChoice): number {
    if (choice === 'none') return 0;
    const full = img.dataUrl.length;
    if (choice === 'full') return full;
    const max = img.kind === 'clip' ? SHRINK_CLIP_PX : SHRINK_PHOTO_PX;
    if (!img.w || !img.h) return Math.round(full * SMALL_UNKNOWN_RATIO);
    const k = Math.min(1, max / Math.max(img.w, img.h));
    return Math.min(full, Math.round(img.w * k * img.h * k * SMALL_BYTES_PER_PX));
}

export interface PageSetSize {
    bytes: number;
    textBytes: number;
    imageBytes: number;
    pages: number;
    persons: number;
    images: number;
}

/**
 * The file's size without building it (§6.3): the text by page (constants
 * measured on the person page and the book's blocks) and the images after
 * reduction — the registry's real length once pages have been rendered into
 * it, else every image the pages show, reduced as the choice says.
 * `opts` overrides the set's image choices (the dialog's alternatives).
 */
export function estimatePageSetSize(set: PageSet, opts: { clips?: ImageChoice; photos?: ImageChoice } = {}): PageSetSize {
    const clips = opts.clips ?? set.options.clips;
    const photos = opts.photos ?? set.options.photos;
    let text = SHELL_BYTES + set.searchIndex.length * SEARCH_ENTRY_BYTES;
    for (const page of set.pages) {
        switch (page.kind) {
            case 'person': text += PERSON_PAGE_BYTES; break;
            case 'family': text += FAMILY_PAGE_BYTES; break;
            case 'rod': case 'branch': case 'hub': case 'tree': {
                const rod = page.kind === 'rod' && page.id ? set.protectedTree.lineages.rods.get(page.id as RodId) : undefined;
                const people = rod ? rod.memberIds.length + rod.spouses.length : page.kind === 'branch' ? set.selection.personIds.length : 0;
                text += ROD_PAGE_BYTES + people * ROD_ROW_BYTES;
                break;
            }
            case 'index': text += set.selection.personIds.length * INDEX_ROW_BYTES; break;
            case 'map': text += MAP_PAGE_BYTES; break;
        }
    }
    const same = clips === set.options.clips && photos === set.options.photos;
    const list = pageSetImages(set);
    let img = 0;
    let count = 0;
    if (same && set.images.count > 0) {
        img = set.images.length;
        count = set.images.count;
    } else {
        for (const i of list) {
            const b = imageBytes(i, i.kind === 'clip' ? clips : photos);
            if (b > 0) { img += b; count++; }
        }
    }
    return { bytes: text + img, textBytes: text, imageBytes: img, pages: set.pages.length, persons: set.personSlug.size, images: count };
}
