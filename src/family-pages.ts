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
import { placeAliasMap, variantGroupKey } from './place-groups.js';
import { placeKey } from './places.js';
import { shownNameOrEmpty, shownNameParts } from './person-name.js';
import { feminineForm, isGapOnlyName } from './surnames.js';
export { isGapOnlyName };
import { asciiSlug } from './filenames.js';
import { normalizeSearchText, searchableSurnames, alternateNames } from './name-search.js';
import {
    LineageIndex, Rod, RodId, Selection, otherFamilyRods, rodGenerations, rodNameForms, rodOfPersonForCrumbs, rods as allRods, selection,
} from './lineage.js';
import { BookSelectionSpec, lineageSpec } from './book-model.js';
import { sortRods } from './rods-overview.js';
import { PERSON_PAGE_DEFAULT_PRIVACY, ProtectedPersonPageTree, dataUrlImageSize, personPageFileName, protectPersonPageTree } from './person-page.js';
import { ImageChoice, ImageRegistry, RegistryImageKind, SHRINK_CLIP_PX, SHRINK_PHOTO_PX } from './image-registry.js';
import type { HistoryPayload, PersonHistoryEnv } from './history.js';

export type PageKind = 'hub' | 'rod' | 'branch' | 'family' | 'person' | 'index' | 'map' | 'tree' | 'other' | 'persons' | 'ancestors' | 'rodTimeline';

/** The four indexes (spec 026 §3.5). */
export type PageSetIndexKind = 'persons' | 'families' | 'surnames' | 'places';

export interface PageCrumb { slug: string; label: string }

export interface SetPage {
    slug: string;
    kind: PageKind;
    /**
     * What the page is about: a lineage's id ('rod', 'rodTimeline'), a union's ('family'), a
     * person's ('person', 'branch' and 'ancestors': the starting person), the index's kind
     * ('index'); none for the hub, the tree and the map.
     */
    id?: string;
    /** Plain text (not escaped). */
    title: string;
    /** Where the page stands in the set (§3.2), the page itself last; [] for the introduction. */
    crumbs: PageCrumb[];
    /**
     * The whole tree (spec 026 P3 §2.3): the lineage the page stands under by
     * its breadcrumbs ('other' = the "Other families"), the rod picker's current
     * line; none for the introduction, the indexes and the map.
     */
    under?: RodId | 'other';
    /** An index split by letters (1102 §7.4): the letter's key ('' the names without a surname). */
    letter?: string;
}

/** One letter of an index split by letters (1102 §7.4). */
export interface PageSetIndexLetter {
    /** The letter as indexLetter gives it ('' the names without a surname). */
    key: string;
    slug: string;
    /** Rows under the letter. */
    rows: number;
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
    /** The sort key: the shown surname, then the given name (plain text). */
    o: string;
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
    /** What the person pages carry (1102 §4.4, default all on); `sources` and `stories` here win over the fields above. */
    groups?: Partial<PageSetGroups>;
    /** A timeline page for every line with a page (1102 §5, default false: the dialog's "Timelines", the window on). */
    timelines?: boolean;
    /**
     * No page of their own for people with only a name and years (1102 §7.3): a
     * row on the parents' family page and in the index, without a link. Default false.
     */
    minimal?: boolean;
    /** The research's history (the timelines' history layer); none: no layer. */
    history?: { payload: HistoryPayload; env?: PersonHistoryEnv } | null;
    now?: Date;
}

/** The groups of the person pages a set carries (1102 §4.4); stories and sources also on the family pages. */
export interface PageSetGroups {
    history: boolean;
    childEvents: boolean;
    stories: boolean;
    sources: boolean;
    materials: boolean;
    pdf: boolean;
}

export const PAGE_SET_GROUP_KEYS: readonly (keyof PageSetGroups)[] = ['history', 'childEvents', 'stories', 'sources', 'materials', 'pdf'];

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
    options: Required<Pick<PageSetOptions, 'lang' | 'privacy' | 'families' | 'clips' | 'photos' | 'map' | 'sources' | 'stories' | 'timelines' | 'minimal'>> & { now: Date; groups: PageSetGroups };
    /** The research's history for the timelines (null: none). */
    history: { payload: HistoryPayload; env?: PersonHistoryEnv } | null;
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
    /** The lines' timeline pages (1102 §5). */
    rodTimelineSlug: Map<RodId, string>;
    /** Slugs of the indexes and of the map ('' for a page the set does not have). */
    indexSlug: Record<PageSetIndexKind, string>;
    /** The indexes split by letters (1102 §7.4), their letters in order; [] for an index on one page. */
    indexLetters: Record<PageSetIndexKind, PageSetIndexLetter[]>;
    /**
     * The people with only a name and years (1102 §7.3) among those who may have a
     * page: without a page under `options.minimal`, else the pages the option saves.
     */
    minimalIds: Set<PersonId>;
    mapSlug: string;
    /** The introduction's slug: the hub, the single lineage or the branch. */
    introSlug: string;
    /**
     * The whole tree (spec 026 P3 §1.4): the page of the "Other families" ('' none),
     * its small lineages (in the order of the overview, those of the protected
     * living only left out) with their anchors, and the people outside the
     * lineages it lists (with a page, by birth).
     */
    otherSlug: string;
    otherRodIds: RodId[];
    otherAnchor: Map<RodId, string>;
    otherPersonIds: PersonId[];
    images: ImageRegistry;
    searchIndex: SearchEntry[];
    /** The tree's name as the app gave it ('' none): the introduction of chosen people names it. */
    treeName: string;
}

/** The depth of a set of ancestors when none is chosen (1102 §4.1). */
export const PAGE_SET_ANCESTOR_GENERATIONS = 4;

/** Fixed slugs (§0.6): the same in every language, stable between saves. */
export const PAGE_SET_HUB_SLUG = 'uvod';
export const PAGE_SET_INDEX_SLUGS: Record<PageSetIndexKind, string> = {
    persons: 'rejstrik-osoby', families: 'rejstrik-rodiny', surnames: 'rejstrik-prijmeni', places: 'rejstrik-obce',
};
export const PAGE_SET_MAP_SLUG = 'mapa-obci';
export const PAGE_SET_OTHER_SLUG = 'dalsi-rodiny';

/** Above this many rows an index of people, families or places is a page per letter (1102 §7.4); surnames stay one page. */
export const PAGE_SET_INDEX_LETTER_ROWS = 500;
/** From this many pages the dialog offers (and turns on) the people without a page of their own (1102 §7.3). */
export const PAGE_SET_MINIMAL_FROM_PAGES = 1000;

/**
 * A person with only a name and years (1102 §7.3): no event but a birth or a
 * death without a place, no story, portrait, attachment, note or source of
 * their own. Read on the protected tree.
 */
export function isMinimalPerson(p: Person): boolean {
    if (p.birthPlace?.trim() || p.deathPlace?.trim() || p.birthAddress?.trim() || p.deathAddress?.trim()) return false;
    if ((p.events ?? []).length) return false;
    if (p.story?.text?.trim() || p.photo || (p.attachments ?? []).length || p.notes?.trim()) return false;
    return personSourceIds(p).length === 0;
}

/** An unreadable place of a transcription: "[?]", "[...]", "[nečitelné]" (1102). */
const TRANSCRIPTION_GAP = /\[[^\]]*\]/gu;

/** The index key of the names that start with an unreadable place ("[?]a[?]har"): after the letters, before those without a surname (1102). */
export const INDEX_UNCERTAIN = '?';

/**
 * The letter an index groups a name under (§3.5): Czech "Ch" is a letter of its own
 * (after H); a letter the language does not tell from its base letter goes
 * with it (Á with A in Czech, Ä with A in German), one that it does stays
 * apart (Č, Ř, Š in Czech). Leading quotes or brackets other than "[" are
 * skipped; a name starting with an unreadable place ("[?]a[?]har") or
 * without any letter goes under INDEX_UNCERTAIN (1102).
 */
export function indexLetter(text: string, lang: Language): string {
    const t0 = text.trim();
    if (!t0) return '';
    const t = t0.replace(/^[^\p{L}[]+/u, '');
    if (!t || t.startsWith('[')) return INDEX_UNCERTAIN;
    if (lang === 'cs' && /^ch/i.test(t)) return 'Ch';
    const ch = Array.from(t)[0].toLocaleUpperCase(lang);
    const base = ch.normalize('NFD').replace(/\p{M}/gu, '');
    return base && base !== ch && new Intl.Collator(lang, { sensitivity: 'base' }).compare(ch, base) === 0 ? base : ch;
}

/** A person's surname for the index: '' for one of unreadable places only ("[?]", 1102). */
function indexSurname(p: Person): string {
    const sur = shownNameParts(p).surname.trim();
    return isGapOnlyName(sur) ? '' : sur;
}

/** A person's letter in the index of people: the shown surname's. */
export function personIndexLetter(p: Person, lang: Language): string {
    return indexLetter(indexSurname(p), lang);
}

/** A person's sort key in the index of people: an uncertain surname after the letters, those without a surname last. */
export function personIndexSort(p: Person): string {
    const sur = indexSurname(p);
    return `${!sur ? '2' : indexLetter(sur, 'en') === INDEX_UNCERTAIN ? '1' : '0'} ${surnameFirst(p)}`;
}

/** The keys of an index's letters in order: the letters as found, then INDEX_UNCERTAIN, then '' (1102). */
export function orderIndexKeys(keys: Iterable<string>): string[] {
    const all = [...keys];
    return [...all.filter(k => k && k !== INDEX_UNCERTAIN), ...all.filter(k => k === INDEX_UNCERTAIN), ...all.filter(k => !k)];
}

/** A family's sort key and letter in the index of families: the husband's surname first. */
export function familyIndexSort(tree: StromData, u: Partnership): string {
    // A husband's surname starting with an unreadable place after the letters, as its index letter (1102).
    const first = partnersOf(tree, u)[0];
    const rank = first && indexLetter(indexSurname(first), 'en') === INDEX_UNCERTAIN ? '1' : '0';
    return `${rank} ${partnersOf(tree, u).map(p => surnameFirst(p)).join(' ')}`;
}

export function familyIndexLetter(tree: StromData, u: Partnership, lang: Language): string {
    const first = partnersOf(tree, u)[0];
    return first ? indexLetter(indexSurname(first) || shownNameOrEmpty(first).replace(TRANSCRIPTION_GAP, '').trim(), lang) : '';
}

/** A letter's part of a slug: ASCII, "ch" for Ch, a letter with a mark apart from its base ("c-hacek"), the names without a surname "bez-prijmeni". */
function letterSlug(key: string): string {
    if (!key) return 'bez-prijmeni';
    if (key === INDEX_UNCERTAIN) return 'nejiste-cteni';
    const a = asciiSlug(key) || 'x';
    if (a === key.toLowerCase()) return a;
    const mark = key.normalize('NFD').replace(/^\P{M}+/u, '').charAt(0);
    const MARKS: Record<string, string> = { '\u030C': 'hacek', '\u0301': 'carka', '\u030A': 'krouzek', '\u0308': 'prehlaska', '\u0300': 'gravis', '\u0302': 'strisky', '\u0328': 'ocasek' };
    return `${a}-${MARKS[mark] ?? 'x'}`;
}

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

/** "Fíšek Josef": a person's sort key in the search and the index of people (plain text). */
export function surnameFirst(p: Person): string {
    const parts = shownNameParts(p);
    return [parts.surname.trim(), parts.given.trim()].filter(Boolean).join(' ') || shownNameOrEmpty(p) || '?';
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
export function pageSetRodLabel(prot: ProtectedPersonPageTree, rod: Rod): string {
    const label = prot.rodLabels.get(rod.id) ?? rod.surname;
    if (!prot.living.has(rod.founderId) || prot.privacy === 'full' || prot.privacy === 'minimal') return label;
    return prot.privacy === 'anonymous' ? '' : rod.surname;
}

function rodTitleOf(lang: Language, label: string): string {
    const F = getStringsForLang(lang).familyPages;
    return label ? F.rodTitle(label) : F.rodGeneric;
}

/**
 * The set's lineages: chosen ones; for the whole tree every lineage over the
 * small ones (spec 026 P3 §1.1) in the tree overview's size order (`sortRods`,
 * so the introduction and the choice list them as the overview does); none
 * for a branch, ancestors or chosen people.
 */
function setRods(prot: ProtectedPersonPageTree, spec: BookSelectionSpec, lang: string): Rod[] {
    const index = prot.lineages;
    if (spec.kind === 'rods') return spec.rods.map(id => index.rods.get(id)).filter((r): r is Rod => !!r);
    if (spec.kind === 'tree') return sortRods(allRods(index).filter(r => !r.small), 'size', prot.rodLabels, lang);
    return [];
}

/**
 * The small lineages of the "Other families" (spec 026 P3 §1.4, §6.3): the
 * overview's other families, without a lineage of protected living people only.
 */
function otherRods(prot: ProtectedPersonPageTree): Rod[] {
    const tree = prot.tree;
    return otherFamilyRods(prot.lineages).filter(rod => rod.memberIds.some(id => !!realPerson(tree, id) && !isProtectedPerson(prot, id)));
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
    const sources = opts.groups?.sources ?? opts.sources ?? true;
    const stories = opts.groups?.stories ?? opts.stories ?? true;
    const groups: PageSetGroups = {
        history: opts.groups?.history ?? true, childEvents: opts.groups?.childEvents ?? true, stories, sources,
        materials: opts.groups?.materials ?? true, pdf: opts.groups?.pdf ?? true,
    };
    const options: PageSet['options'] = {
        lang, privacy: opts.privacy ?? PERSON_PAGE_DEFAULT_PRIVACY, families: opts.families ?? 'pages',
        clips: opts.clips ?? 'full', photos: opts.photos ?? 'full', map: opts.map ?? true,
        sources, stories, groups, timelines: opts.timelines ?? false, minimal: opts.minimal ?? false, now: opts.now ?? new Date(),
    };
    // Ancestors without a depth: the dialog's default (§4.1).
    if (spec.kind === 'ancestors' && spec.generations == null) spec = { ...spec, generations: PAGE_SET_ANCESTOR_GENERATIONS };
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
    const rods = setRods(prot, spec, lang);
    const rodIds = rods.map(r => r.id);
    const whole = spec.kind === 'tree';
    const small = whole ? otherRods(prot) : [];
    const labels = new Map<RodId, string>([...rods, ...small].map(r => [r.id, pageSetRodLabel(prot, r)]));
    const inRods = new Set(rodIds);

    const used = new Set<string>();
    const pages: SetPage[] = [];
    const personSlug = new Map<PersonId, string>();
    const familySlug = new Map<PartnershipId, string>();
    const rodSlug = new Map<RodId, string>();
    const rodTimelineSlug = new Map<RodId, string>();

    // The introduction.
    let intro: SetPage;
    if (spec.kind === 'rods' && rods.length === 1) {
        const rod = rods[0];
        intro = { slug: uniqueSlug(`rod-${asciiSlug(labels.get(rod.id) ?? '') || 'rod'}`, used), kind: 'rod', id: rod.id, title: rodTitleOf(lang, labels.get(rod.id) ?? ''), crumbs: [] };
        rodSlug.set(rod.id, intro.slug);
    } else if (spec.kind === 'ancestors') {
        // The ancestors' page (1102 §4.3): the generations of a pedigree.
        const name = nameOf(tree, spec.person);
        intro = { slug: uniqueSlug(`predci-${asciiSlug(name)}`, used), kind: 'ancestors', id: spec.person, title: F.ancTitle(name), crumbs: [] };
    } else if (spec.kind === 'descendants') {
        const name = nameOf(tree, spec.person);
        intro = { slug: uniqueSlug(`potomci-${asciiSlug(name)}`, used), kind: 'branch', id: spec.person, title: S.book.titleDescendants(name), crumbs: [] };
    } else if (spec.kind === 'persons') {
        // Chosen people (1102 §4.2): their introduction groups them by line.
        intro = { slug: uniqueSlug(PAGE_SET_HUB_SLUG, used), kind: 'persons', title: F.selPersons, crumbs: [] };
    } else if (whole) {
        intro = { slug: uniqueSlug(PAGE_SET_HUB_SLUG, used), kind: 'tree', title: ctx.treeName?.trim() || S.book.title, crumbs: [] };
    } else {
        const named = rods.map(r => labels.get(r.id) ?? '').filter(Boolean);
        intro = { slug: uniqueSlug(PAGE_SET_HUB_SLUG, used), kind: 'hub', title: named.length ? F.hubTitle(named) : F.rodGeneric, crumbs: [] };
    }
    pages.push(intro);
    // The whole tree's breadcrumbs start with "Tree" (spec 026 P3 §2.1).
    const introCrumb: PageCrumb = { slug: intro.slug, label: whole ? F.crumbTree : intro.kind === 'hub' ? F.hub : intro.title };

    // The lineages, each followed by its timeline (1102 §5).
    for (const rod of rods) {
        const label = labels.get(rod.id) ?? '';
        const title = rodTitleOf(lang, label);
        let slug = rodSlug.get(rod.id);
        if (!slug) {
            slug = uniqueSlug(`rod-${asciiSlug(label) || 'rod'}`, used);
            rodSlug.set(rod.id, slug);
            pages.push({ slug, kind: 'rod', id: rod.id, title, crumbs: [introCrumb, { slug, label: title }], ...(whole ? { under: rod.id } : {}) });
        }
        if (!options.timelines) continue;
        const tl = uniqueSlug(`casova-osa-${asciiSlug(label) || 'rod'}`, used);
        rodTimelineSlug.set(rod.id, tl);
        const rodCrumbs: PageCrumb[] = slug === intro.slug ? [] : [introCrumb];
        pages.push({
            slug: tl, kind: 'rodTimeline', id: rod.id, title: label ? F.rodTimeline(label) : F.timeline,
            crumbs: [...rodCrumbs, { slug, label: title }, { slug: tl, label: F.timelineLink }], ...(whole ? { under: rod.id } : {}),
        });
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

    // The whole tree's "Other families" (spec 026 P3 §1.4): its small lineages and the people outside the lineages.
    const otherIds = new Set(small.map(r => r.id));
    const smallFam = new Set<PartnershipId>();
    for (const rod of small) for (const fid of rod.familyIds) smallFam.add(fid);
    const crumbOf = new Map<PersonId, RodId | null>();
    const crumbUnion = new Map<PersonId, PartnershipId>();
    const otherPersonIds: PersonId[] = [];

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

    // The people: members and married-in spouses, the protected left out.
    const spouses = new Set(sel.spouseIds);
    const mayHavePage = sel.personIds.filter(id => !!realPerson(tree, id) && !isProtectedPerson(prot, id));
    // People with only a name and years (1102 §7.3); the person a branch or a pedigree starts from keeps the page.
    const start = 'person' in spec ? spec.person : null;
    const minimalIds = new Set(mayHavePage.filter(id => id !== start && isMinimalPerson(tree.persons[id]!)));
    const withPage = options.minimal ? mayHavePage.filter(id => !minimalIds.has(id)) : mayHavePage;
    if (whole) {
        for (const id of withPage) {
            const c = rodOfPersonForCrumbs(index, id);
            const rodId = c.rodId && (inRods.has(c.rodId) || otherIds.has(c.rodId)) ? c.rodId : null;
            crumbOf.set(id, rodId);
            if (c.unionId && rodId) crumbUnion.set(id, c.unionId);
            if (!rodId) otherPersonIds.push(id);
        }
    }
    let otherSlug = '';
    if (whole && (small.length || otherPersonIds.length)) {
        otherSlug = uniqueSlug(PAGE_SET_OTHER_SLUG, used);
        pages.push({ slug: otherSlug, kind: 'other', title: F.otherFams, crumbs: [introCrumb, { slug: otherSlug, label: F.otherFams }], under: 'other' });
    }
    const otherAnchor = new Map<RodId, string>();
    {
        const anchors = new Set<string>();
        for (const rod of small) otherAnchor.set(rod.id, `${otherSlug}--${uniqueSlug(asciiSlug(labels.get(rod.id) || rod.surname) || 'rod', anchors)}`);
    }
    const otherCrumb: PageCrumb = otherSlug ? { slug: otherSlug, label: F.otherFams } : introCrumb;
    /** Where a lineage of the whole tree stands: its page, else the "Other families". */
    const underOf = (rodId: RodId | null | undefined): { crumb: PageCrumb; under: RodId | 'other' } =>
        rodId && rodSlug.has(rodId) ? { crumb: rodCrumb(rodId), under: rodId } : { crumb: otherCrumb, under: 'other' };

    for (const fid of families) {
        const u = tree.partnerships[fid];
        const slug = familySlug.get(fid)!;
        const memberRod = famRod.get(fid) ?? partnersOf(tree, u).map(p => rodOfMember(p.id)).find(r => !!r) ?? null;
        const self: PageCrumb = { slug, label: familyFirstNames(tree, u, lang) };
        if (whole) {
            // The husband's lineage (without a husband the mother's); a family of a small lineage under the "Other families".
            const w = underOf(memberRod ?? (smallFam.has(fid) ? null : undefined));
            pages.push({ slug, kind: 'family', id: fid, title: familyTitle(tree, u, lang), crumbs: [introCrumb, w.crumb, self], under: w.under });
            continue;
        }
        pages.push({ slug, kind: 'family', id: fid, title: familyTitle(tree, u, lang), crumbs: [rodCrumb(memberRod), self] });
    }

    for (const id of withPage) {
        personSlug.set(id, uniqueSlug(personPageFileName({ lang, tree, personId: id, privacy: prot.privacy, living: prot.living }).replace(/\.html$/, ''), used));
    }
    const famCrumb = (fid: PartnershipId | undefined): PageCrumb[] => {
        const slug = fid ? familySlug.get(fid) : undefined;
        return slug && fid ? [{ slug, label: familyFirstNames(tree, tree.partnerships[fid], lang) }] : [];
    };
    const unionsOf = (id: PersonId): Partnership[] => (tree.persons[id]?.partnerships ?? []).map(pid => tree.partnerships[pid]).filter((u): u is Partnership => !!u);
    // Each child's first union with a page (in the order of the tree's unions).
    const parentsPage = new Map<PersonId, PartnershipId>();
    for (const u of Object.values(tree.partnerships)) {
        if (!familySlug.has(u.id)) continue;
        for (const c of u.childIds ?? []) if (!parentsPage.has(c)) parentsPage.set(c, u.id);
    }
    for (const id of withPage) {
        const slug = personSlug.get(id)!;
        const self: PageCrumb = { slug, label: nameOf(tree, id) };
        let crumbs: PageCrumb[];
        let under: RodId | 'other' | undefined;
        if (whole) {
            // Spec 026 P3 §2.1: a member under the own lineage and the parents' family, a spouse who married in under the
            // husband's lineage and their family, the small lineages and the people outside them under the "Other families".
            const w = underOf(crumbOf.get(id));
            const via = crumbUnion.get(id);
            crumbs = [introCrumb, w.crumb, ...famCrumb(via ?? parentsPage.get(id)), self];
            under = w.under;
        } else if (spouses.has(id)) {
            // A married-in spouse: the spouse's lineage (or the own birth lineage in the file), the own family.
            const own = unionsOf(id).find(u => familySlug.has(u.id));
            const viaSpouse = own ? partnersOf(tree, own).map(p => rodOfMember(p.id)).find(r => !!r) : null;
            crumbs = [rodCrumb(viaSpouse ?? rodOfMember(id)), ...famCrumb(own?.id), self];
        } else {
            crumbs = [rodCrumb(rodOfMember(id)), ...famCrumb(parentsPage.get(id)), self];
        }
        pages.push({ slug, kind: 'person', id, title: nameOf(tree, id), crumbs, ...(under ? { under } : {}) });
    }

    // The indexes and the map.
    const indexSlug = {} as Record<PageSetIndexKind, string>;
    const startCrumb: PageCrumb = whole ? introCrumb : { slug: intro.slug, label: F.start };
    const indexLetters: Record<PageSetIndexKind, PageSetIndexLetter[]> = { persons: [], families: [], surnames: [], places: [] };
    const letterKeys = indexLetterKeys({ protectedTree: prot, selection: sel, personSlug, familySlug, options });
    for (const k of ['persons', 'families', 'surnames', 'places'] as const) {
        const keys = k === 'surnames' ? null : letterKeys[k];
        if (!keys) {
            const slug = uniqueSlug(PAGE_SET_INDEX_SLUGS[k], used);
            indexSlug[k] = slug;
            pages.push({ slug, kind: 'index', id: k, title: F.indexTitle[k], crumbs: [startCrumb, { slug, label: F.indexTitle[k] }] });
            continue;
        }
        // A page per letter (1102 §7.4): the index's link leads to the first letter.
        for (const [key, rows] of keys) {
            const slug = uniqueSlug(`${PAGE_SET_INDEX_SLUGS[k]}-${letterSlug(key)}`, used);
            const label = key === INDEX_UNCERTAIN ? F.idxUncertain : key || S.book.noSurname;
            const title = k === 'persons' ? F.idxLetter(label) : `${F.indexTitle[k]} · ${label}`;
            indexLetters[k].push({ key, slug, rows });
            pages.push({ slug, kind: 'index', id: k, letter: key, title, crumbs: [startCrumb, { slug, label: title }] });
        }
        indexSlug[k] = indexLetters[k][0].slug;
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
        spec, options, history: opts.history ?? null, selection: sel, protectedTree: prot, rodIds, rodLabels: labels,
        pages, bySlug: new Map(pages.map(p => [p.slug, p])), personSlug, familySlug, rodSlug, rodTimelineSlug, indexSlug, indexLetters, minimalIds, mapSlug,
        introSlug: intro.slug, otherSlug, otherRodIds: small.map(r => r.id), otherAnchor, otherPersonIds, images, searchIndex: [], treeName: ctx.treeName?.trim() ?? '',
    };
    out.searchIndex = buildSearchIndex(out, rods);
    return out;
}

/**
 * The letters of the indexes of people, families and places with more than
 * PAGE_SET_INDEX_LETTER_ROWS rows (1102 §7.4), in the index's order, each with
 * its count of rows; null for an index on one page.
 */
function indexLetterKeys(set: Pick<PageSet, 'protectedTree' | 'selection' | 'personSlug' | 'familySlug' | 'options'>): Record<'persons' | 'families' | 'places', [string, number][] | null> {
    const tree = set.protectedTree.tree;
    const lang = set.options.lang;
    const count = (rows: { key: string; sort: string }[]): [string, number][] | null => {
        if (rows.length <= PAGE_SET_INDEX_LETTER_ROWS) return null;
        rows.sort((a, b) => a.sort.localeCompare(b.sort, lang));
        const out = new Map<string, number>();
        for (const r of rows) out.set(r.key, (out.get(r.key) ?? 0) + 1);
        return orderIndexKeys(out.keys()).map(k => [k, out.get(k)!]);
    };
    const people = pageSetSearchPeople(set).map(id => {
        const p = tree.persons[id]!;
        return { key: personIndexLetter(p, lang), sort: personIndexSort(p) };
    });
    const fams = set.selection.familyIds.filter(fid => set.familySlug.has(fid) && tree.partnerships[fid]).map(fid => {
        const u = tree.partnerships[fid];
        return { key: familyIndexLetter(tree, u, lang), sort: familyIndexSort(tree, u) };
    });
    const places = pageSetPlaces(set).map(p => ({ key: indexLetter(p.name, lang), sort: p.name }));
    return { persons: count(people), families: count(fams), places: count(places) };
}

/** The index page a row of a split index stands on (1102 §7.4); the index's page when it is one. */
export function indexPageOf(set: Pick<PageSet, 'indexSlug' | 'indexLetters'>, kind: PageSetIndexKind, key: string): string {
    return set.indexLetters[kind].find(l => l.key === key)?.slug ?? set.indexSlug[kind];
}

/** The people of the search index, in its order: `set.searchIndex[i]` is `pageSetSearchPeople(set)[i]`. */
export function pageSetSearchPeople(set: Pick<PageSet, 'selection' | 'protectedTree'>): PersonId[] {
    return set.selection.personIds.filter(id => !!realPerson(set.protectedTree.tree, id));
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
    for (const id of pageSetSearchPeople(set)) {
        const p = realPerson(tree, id)!;
        const n = shownNameOrEmpty(p) || '?';
        const keys: string[] = [];
        const add = (text: string): void => {
            for (const w of normalizeSearchText(text).split(' ')) if (w && !keys.includes(w)) keys.push(w);
        };
        add(n);
        if (isProtectedPerson(prot, id)) {
            out.push({ s: '', n, y: yearsOf(p), t: '', k: keys.join(' '), o: surnameFirst(p) });
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
        out.push({ s: set.personSlug.get(id) ?? '', n, y: yearsOf(p), t, k: keys.join(' '), o: surnameFirst(p) });
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
        case 'persons':
            stem = F.fileStem.persons;
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
const ZIP_PAGE_BYTES = 5_600;         // a file of a set: its head, the bar (1102 §7.5)
const PICK_ROW_BYTES = 340;           // a line in the choice of a line, repeated in the files of a set
/** From this many lines a set of files keeps the whole choice of a line to the introduction and the lines' pages (1102 §7.5). */
export const ZIP_PICK_LINES = 30;
const PERSON_PAGE_BYTES = 24_000;
const FAMILY_PAGE_BYTES = 9_000;
const ROD_PAGE_BYTES = 8_000;
const ROD_ROW_BYTES = 450;            // one person of the lineage's generations
const INDEX_ROW_BYTES = 160;          // one row of an index
const TIMELINE_ROW_BYTES = 900;       // a person's events on a line's timeline (birth, marriage, death, moves)
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
    /** The same in MB (1102 §7.1). */
    mb: number;
    textMb: number;
    /** How long saving takes on the device (1102 §7.1). */
    seconds: number;
    /** The set of files (1102 §7.5): every file carries its head and bar, so a little more than the single file. */
    zipBytes: number;
}

/** The device the save runs on (1102 §7.1): a phone is a coarse pointer up to 1024 px. */
export type PageSetDevice = 'desktop' | 'phone';

/** Milliseconds per page and per reduced image (1102 §7.1, measured on a desktop; a phone about six times slower). */
export const PAGE_SET_MS_PER_PAGE: Record<PageSetDevice, number> = { desktop: 3.6, phone: 21.6 };
export const PAGE_SET_MS_PER_IMAGE: Record<PageSetDevice, number> = { desktop: 25, phone: 150 };

/**
 * The file's size without building it (§6.3): the text by page (constants
 * measured on the person page and the book's blocks) and the images after
 * reduction — the registry's real length once pages have been rendered into
 * it, else every image the pages show, reduced as the choice says.
 * `opts` overrides the set's image choices (the dialog's alternatives).
 */
export function estimatePageSetSize(set: PageSet, opts: { clips?: ImageChoice; photos?: ImageChoice; device?: PageSetDevice } = {}): PageSetSize {
    const clips = opts.clips ?? set.options.clips;
    const photos = opts.photos ?? set.options.photos;
    let text = SHELL_BYTES + set.searchIndex.length * SEARCH_ENTRY_BYTES;
    for (const page of set.pages) {
        switch (page.kind) {
            case 'person': text += PERSON_PAGE_BYTES; break;
            case 'family': text += FAMILY_PAGE_BYTES; break;
            case 'rod': case 'branch': case 'hub': case 'tree': case 'persons': case 'ancestors': {
                const rod = page.kind === 'rod' && page.id ? set.protectedTree.lineages.rods.get(page.id as RodId) : undefined;
                const listed = page.kind === 'branch' || page.kind === 'persons' || page.kind === 'ancestors';
                const people = rod ? rod.memberIds.length + rod.spouses.length : listed ? set.selection.personIds.length : 0;
                text += ROD_PAGE_BYTES + people * ROD_ROW_BYTES;
                break;
            }
            case 'index': {
                // A page of a split index carries its letter's rows (1102 §7.4).
                const letter = page.letter !== undefined ? set.indexLetters[page.id as PageSetIndexKind]?.find(l => l.key === page.letter) : undefined;
                text += (letter ? letter.rows : set.selection.personIds.length) * INDEX_ROW_BYTES;
                break;
            }
            case 'map': text += MAP_PAGE_BYTES; break;
            case 'rodTimeline': {
                const rod = page.id ? set.protectedTree.lineages.rods.get(page.id as RodId) : undefined;
                text += ROD_PAGE_BYTES + (rod ? rod.memberIds.length + rod.spouses.length : 0) * TIMELINE_ROW_BYTES;
                break;
            }
        }
    }
    const same = clips === set.options.clips && photos === set.options.photos;
    const list = pageSetImages(set);
    let img = 0;
    let count = 0;
    let reduced = 0;
    for (const i of list) {
        const choice = i.kind === 'clip' ? clips : photos;
        if (choice === 'small') reduced++;
        const b = imageBytes(i, choice);
        if (b > 0) { img += b; count++; }
    }
    if (same && set.images.count > 0) {
        img = set.images.length;
        count = set.images.count;
    }
    const device = opts.device ?? 'desktop';
    const pages = set.pages.length;
    const seconds = (pages * PAGE_SET_MS_PER_PAGE[device] + reduced * PAGE_SET_MS_PER_IMAGE[device]) / 1000;
    // The set of files: every file its head and bar, the whole tree's files their choice of a line (1102 §7.5).
    let zipText = text + pages * ZIP_PAGE_BYTES;
    if (set.spec.kind === 'tree') {
        const items = set.rodIds.length + 2;
        const full = set.rodIds.length > ZIP_PICK_LINES ? set.pages.filter(p => p.kind === 'tree' || p.kind === 'rod' || p.kind === 'other').length : pages;
        zipText += (full * items + (pages - full) * 3) * PICK_ROW_BYTES;
    }
    return {
        bytes: text + img, textBytes: text, imageBytes: img, pages, persons: set.personSlug.size, images: count,
        mb: (text + img) / 1e6, textMb: text / 1e6, seconds, zipBytes: zipText + img,
    };
}

/** A place of the set's people (§3.5 the index of places): who has a dated record there, and when. */
export interface SetPlaceRow {
    /** placeKey of the name (the same grouping as rodPlaceSpans). */
    key: string;
    /** The spelling used most. */
    name: string;
    from: number;
    to: number;
    /** The people with a record there, by birth. */
    personIds: PersonId[];
    /** placeKeys of the place's other spellings joined to it (§4 of spec 034: a research record, Unify's other names). */
    alsoKeys?: string[];
}

/**
 * The places of the set's people with a page (§3.5, §5: the protected living
 * say nothing): each person's birth, death and events, each family's wedding
 * for both partners; only dated records (a span on the axis). Most people
 * first, then the earlier start, then the name — as "Where the line lived".
 */
export function pageSetPlaces(set: Pick<PageSet, 'protectedTree' | 'selection' | 'personSlug' | 'options'>): SetPlaceRow[] {
    const tree = set.protectedTree.tree;
    const shown = (id: PersonId | undefined | null): boolean => !!id && set.personSlug.has(id);
    const acc = new Map<string, { names: Map<string, number>; keys: Map<string, number>; from: number; to: number; ids: Set<PersonId> }>();
    // A place's spellings are one row (§4 of spec 034): by its research record or Unify's other names.
    const ctx = { data: tree, aliases: placeAliasMap(tree) };
    const note = (place: string | undefined, date: string | undefined, who: PersonId): void => {
        const name = place?.trim();
        const year = yearOf(date);
        if (!name || year === null) return;
        const own = placeKey(name) || name.toLowerCase();
        const key = variantGroupKey(own, ctx) ?? own;
        let a = acc.get(key);
        if (!a) { a = { names: new Map(), keys: new Map(), from: year, to: year, ids: new Set() }; acc.set(key, a); }
        a.keys.set(own, (a.keys.get(own) ?? 0) + 1);
        a.names.set(name, (a.names.get(name) ?? 0) + 1);
        a.from = Math.min(a.from, year);
        a.to = Math.max(a.to, year);
        a.ids.add(who);
    };
    for (const id of set.selection.personIds) {
        const p = realPerson(tree, id);
        if (!p || !shown(id)) continue;
        note(p.birthPlace, p.birthDate, id);
        note(p.deathPlace, p.deathDate, id);
        for (const ev of p.events ?? []) note(ev.place, ev.date, id);
    }
    for (const uid of set.selection.familyIds) {
        const u = tree.partnerships[uid];
        if (!u) continue;
        const ids = [u.person1Id, u.person2Id].filter((x): x is PersonId => !!x);
        // A family of a protected partner says nothing of where they wed.
        if (ids.some(id => isProtectedPerson(set.protectedTree, id))) continue;
        for (const id of ids) if (shown(id)) note(u.startPlace, u.startDate, id);
    }
    const born = (id: PersonId): number => yearOf(tree.persons[id]?.birthDate) ?? 9999;
    const lang = set.options.lang;
    return [...acc.entries()]
        .map(([group, a]) => {
            const name = tree.placeRecords?.[group]?.names[0]?.name
                ?? [...a.names.entries()].sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0], lang))[0][0];
            const keys = [...a.keys.entries()].sort((x, y) => y[1] - x[1] || (x[0] < y[0] ? -1 : 1)).map(e => e[0]);
            const key = keys.includes(placeKey(name)) ? placeKey(name) : keys[0]!;
            return { key, name, keys: keys.filter(k => k !== key), a };
        })
        .map(({ key, name, keys, a }) => ({
            key, name,
            ...(keys.length ? { alsoKeys: keys } : {}),
            from: a.from, to: a.to,
            personIds: [...a.ids].sort((x, y) => born(x) - born(y) || nameOf(tree, x).localeCompare(nameOf(tree, y), lang)),
        }))
        .sort((x, y) => y.personIds.length - x.personIds.length || x.from - y.from || x.name.localeCompare(y.name, lang));
}

// ─── The set of files' folders (1102 §7.5) ─────────────────────────────────

export interface PageSetFolders {
    rods: string;
    families: string;
    persons: string;
    timelines: string;
    index: string;
    images: string;
    files: string;
}

/** The folders of a set of files, in the file's language. */
export const PAGE_SET_FOLDERS: Record<Language, PageSetFolders> = {
    cs: { rods: 'rody', families: 'rodiny', persons: 'osoby', timelines: 'casove-osy', index: 'rejstrik', images: 'obrazky', files: '_soubory' },
    en: { rods: 'lines', families: 'families', persons: 'people', timelines: 'timelines', index: 'index', images: 'images', files: '_files' },
    de: { rods: 'stammlinien', families: 'familien', persons: 'personen', timelines: 'zeitleisten', index: 'register', images: 'bilder', files: '_dateien' },
};

export function pageSetFolders(set: Pick<PageSet, 'options'>): PageSetFolders {
    return PAGE_SET_FOLDERS[set.options.lang] ?? PAGE_SET_FOLDERS.en;
}

/**
 * A page's file in the set of files (1102 §7.5), ASCII and lower case: the
 * introduction `index.html`; the lines and the "Other families" in the lines'
 * folder, the families, the people, the timelines (by the line's slug) and the
 * indexes with the map (without the "rejstrik-" prefix) each in their own.
 */
export function pageSetPath(set: Pick<PageSet, 'introSlug' | 'bySlug' | 'rodSlug' | 'options'>, slug: string): string {
    if (slug === set.introSlug) return 'index.html';
    const f = pageSetFolders(set);
    const page = set.bySlug.get(slug);
    switch (page?.kind) {
        case 'family': return `${f.families}/${slug}.html`;
        case 'person': return `${f.persons}/${slug}.html`;
        case 'rodTimeline': return `${f.timelines}/${(page.id && set.rodSlug.get(page.id as RodId)) || slug}.html`;
        case 'index': return `${f.index}/${slug.replace(/^rejstrik-/, '')}.html`;
        case 'map': return `${f.index}/${slug}.html`;
        default: return `${f.rods}/${slug}.html`;
    }
}
