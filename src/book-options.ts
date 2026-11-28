/**
 * The family book's options (1031 §4): the choice of people, the parts, the
 * detail per person, the presets, the automatic title and the page estimate.
 * Pure. The book's options never read or change the person card's settings
 * or `lifelineDefaults` (§4.3).
 */

import { HouseId, PersonId, StromData } from './types.js';
import { personSourceIds, partnershipSourceIds } from './model-values.js';
import { PrivacyMode } from './privacy.js';
import { getStringsForLang } from './strings.js';
import { yearOf } from './dates.js';
import { shownNameOrEmpty } from './person-name.js';
import { LineageIndex, buildLineages, otherFamilyRods, rodLabels, selection } from './lineage.js';
import { BookSelectionSpec, buildBookModel, chapterRods, lineageSpec } from './book-model.js';
import { collectHouses, findHouse, houseNamedTitle, type TreeHouse } from './houses.js';
import type { HouseResearch } from './house-bridge.js';
import { houseOutputFilter, housePrivacyContext, houseStoryNamesLiving, type HousePrivacyContext } from './house-privacy.js';

export type { BookSelectionSpec } from './book-model.js';

export type BookLang = 'cs' | 'en' | 'de' | 'pl';
export type BookDetail = 'brief' | 'normal' | 'all';
export type BookPreset = 'family' | 'research' | 'custom';

/**
 * The parts in the order of the dialog and the book: `houses` (spec 030 §8, K7.3) is the Houses chapter after
 * the other families, `houseIndex` the index of houses after the index of people.
 */
export const BOOK_PART_KEYS = ['toc', 'tree', 'families', 'story', 'chart', 'history', 'sources', 'media', 'smallRods', 'houses', 'index', 'houseIndex'] as const;
export type BookPartKey = typeof BOOK_PART_KEYS[number];
export type BookParts = Record<BookPartKey, boolean>;

/**
 * Parts outside the presets (a preset keeps what they say): the Houses chapter and the index of houses.
 * Off by default; on when the tree has a house with its history done (bookHouseDefaults, K7.3).
 */
const OPTIONAL_PARTS: ReadonlySet<BookPartKey> = new Set(['houses', 'houseIndex']);
/** The parts whose default depends on the tree (bookHouseDefaults). */
export const BOOK_HOUSE_PARTS: readonly BookPartKey[] = ['houses', 'houseIndex'];

/** Every part ticked but the optional ones (`houses`, `houseIndex`: see bookHouseDefaults). */
export function defaultBookParts(houses = false): BookParts {
    return Object.fromEntries(BOOK_PART_KEYS.map(k => [k, OPTIONAL_PARTS.has(k) ? houses : true])) as BookParts;
}

/**
 * The default of the Houses chapter and of the index of houses (spec 030 §8, K7.3, question 3): on when the
 * tree has a house whose history the research has done, otherwise off.
 */
export function bookHouseDefaults(env: Pick<BookEnv, 'finishedHouses'>): boolean {
    return !!env.finishedHouses && env.finishedHouses.size > 0;
}

/** Parts that can be unavailable, with the reason the dialog shows (§4.3). */
export type BookPartReasonKey = 'story' | 'chart' | 'history' | 'sources' | 'media' | 'smallRods' | 'houses' | 'houseIndex' | 'houseIndexChapter';

export interface BookOptions {
    selection: BookSelectionSpec;
    /** What is ticked (an unavailable part is left out whatever it says; `families` is always in). */
    parts: BookParts;
    detail: BookDetail;
    /** The people's working notes (§4.5), off by default. */
    notes: boolean;
    /** The researcher's data (§4.5), off by default. */
    research: boolean;
    privacy: PrivacyMode;
    /** The book's language: its headings and labels (the tree's data is not translated). */
    lang: BookLang;
    /** A title typed by hand; empty = automatic (autoBookTitle). */
    title?: string;
    /**
     * A book of a house: people of the last ~100 years by name and role only in the whole book (spec 030
     * K1.4a); on unless false. Off: their data as in any book, the living still by the privacy.
     */
    houseRecent?: boolean;
    /**
     * The Houses chapter's locations (spec 145 T3): a house whose location outputs may show (no people of the
     * last ~100 years, not hidden by hand) with a cut of today's map, its coordinates and how sure it is; on unless
     * false. Off: the town only, as before.
     */
    houseMaps?: boolean;
    /**
     * The stories of houses in which a living person appears (spec 145 T8): in the book unless false. Off: such a
     * story is left out; the other stories, and a story of a house in a saved house page, always go.
     */
    houseStoriesLiving?: boolean;
}

/** Does the book keep people of the last ~100 years to their name and role (a book of a house, K1.4a)? */
export function bookHouseRecent(options: Pick<BookOptions, 'selection' | 'houseRecent'>): boolean {
    return options.selection.kind === 'house' && options.houseRecent !== false;
}

export interface BookPartState {
    available: boolean;
    /** Why not, in the book's language ('' when available). */
    reason: string;
    /** What an available part holds, when the dialog says it ("13 houses → people, years"). */
    note?: string;
}

/** The defaults: the whole tree, "For the family", privacy initials + birth year (§4.6, §4.7). */
export function defaultBookOptions(lang: BookLang): BookOptions {
    return { selection: { kind: 'tree' }, parts: defaultBookParts(), detail: 'normal', notes: false, research: false, privacy: 'initials', lang };
}

/** A preset applied (§4.7); 'custom' changes nothing. */
export function applyBookPreset(options: BookOptions, preset: BookPreset): BookOptions {
    if (preset === 'custom') return options;
    const parts = defaultBookParts();
    for (const k of OPTIONAL_PARTS) parts[k] = !!options.parts[k];
    return preset === 'family'
        ? { ...options, parts, detail: 'normal', notes: false, research: false }
        : { ...options, parts, detail: 'all', notes: true, research: true };
}

/** The preset the options match; any other combination is 'custom'. */
export function bookPresetOf(options: Pick<BookOptions, 'parts' | 'detail' | 'notes' | 'research'>): BookPreset {
    const allParts = BOOK_PART_KEYS.every(k => options.parts[k] || k === 'families' || OPTIONAL_PARTS.has(k));
    if (!allParts) return 'custom';
    if (options.detail === 'normal' && !options.notes && !options.research) return 'family';
    if (options.detail === 'all' && options.notes && options.research) return 'research';
    return 'custom';
}

/** What the tree has that the parts depend on. */
export interface BookEnv {
    /** The lineages, built once by the caller (the dialog recomputes on every change). */
    index?: LineageIndex;
    /** The tree has a history layer (research history). */
    hasHistory?: boolean;
    /** The tree's houses (collectHouses of the same data), worked out once by the caller. */
    houses?: readonly TreeHouse[];
    /** The tree's houses whose history the research has done (the research's list, state `done`). */
    finishedHouses?: ReadonlySet<HouseId>;
    /** The research's result of a house, when read (the location outputs may show, spec 145 T3). */
    houseResearch?: (house: TreeHouse) => HouseResearch | null;
    /** "Now" for the last ~100 years (fixed in tests). */
    now?: Date;
}

function indexOf(data: StromData, env: BookEnv): LineageIndex {
    return env.index && env.index.data === data ? env.index : buildLineages(data);
}

/**
 * The houses of a book (spec 030 §8): the tree's houses where one of the
 * book's people has a record, in the order of the tree's houses (town, then
 * compareHouses).
 */
export function bookHouses(data: StromData, personIds: Iterable<PersonId>, houses: readonly TreeHouse[] = collectHouses(data)): TreeHouse[] {
    const ids = new Set<PersonId>();
    for (const id of personIds) if (data.persons[id] && !data.persons[id].isPlaceholder) ids.add(id);
    return ids.size ? houses.filter(h => h.personIds.some(id => ids.has(id))) : [];
}

/**
 * The houses of the Houses chapter (spec 030 §8, K7.3): the book's houses with their history done by the
 * research or above the threshold (2 generations or 30 years, isOverThreshold).
 */
export function bookChapterHouses(data: StromData, personIds: Iterable<PersonId>, houses: readonly TreeHouse[] = collectHouses(data),
    finished: ReadonlySet<HouseId> = new Set()): TreeHouse[] {
    return bookHouses(data, personIds, houses).filter(h => h.overThreshold || finished.has(h.id));
}

/** The page a cut of the map with its coordinates takes in the Houses chapter (spec 145 T3). */
export const HOUSE_MAP_PAGES = 0.35;

/** The Houses chapter's pages: the introduction, then a house's head, its numbers and records (35 rows a page), its map. */
export function housesChapterPages(houses: readonly TreeHouse[], withMap: ReadonlySet<HouseId> = new Set()): number {
    if (!houses.length) return 0;
    return 0.5 + houses.reduce((n, h) => n + 0.4 + (h.numbers.length + new Set(h.facts.map(f => f.factRef)).size) / 35
        + (withMap.has(h.id) ? HOUSE_MAP_PAGES : 0), 0);
}

const locationCtx = new WeakMap<StromData, { year: number; ctx: HousePrivacyContext }>();

/** The dialog asks at every change: the judge of the living once per state of the data and year. */
function keptHouseCtx(data: StromData, now: Date): HousePrivacyContext {
    let kept = locationCtx.get(data);
    if (!kept || kept.year !== now.getFullYear()) locationCtx.set(data, kept = { year: now.getFullYear(), ctx: housePrivacyContext(data, now) });
    return kept.ctx;
}

/**
 * Whether a living person appears in the story of one of these houses (spec 145 T8), by the research's results
 * read so far: the book's and the family pages' option "Stories of houses with living people" shows only then.
 */
export function housesStoryWithLiving(data: StromData, houses: readonly TreeHouse[],
    research: ((house: TreeHouse) => HouseResearch | null | undefined) | undefined, now: Date = new Date()): boolean {
    if (!houses.length || !research) return false;
    const withStory = houses.map(h => research(h)).filter(r => r?.story?.status);
    if (!withStory.length) return false;
    const ctx = keptHouseCtx(data, now);
    return withStory.some(r => houseStoryNamesLiving(r, ctx));
}

/** Does the book show the stories of houses in which a living person appears (spec 145 T8)? On unless switched off. */
export function bookHouseStoriesLiving(options: Pick<BookOptions, 'houseStoriesLiving'>): boolean {
    return options.houseStoriesLiving !== false;
}

/**
 * The houses of these whose location outputs may show (spec 145 T3, houseOutputFilter: no people of the last ~100
 * years, not hidden by hand), by the research's results read so far.
 */
export function housesWithLocation(data: StromData, houses: readonly TreeHouse[], env: Pick<BookEnv, 'houseResearch' | 'now'> = {}): Set<HouseId> {
    const out = new Set<HouseId>();
    if (!houses.length) return out;
    const now = env.now ?? new Date();
    // The dialog asks at every change: the judge of the living once per state of the data and year.
    const ctx = keptHouseCtx(data, now);
    for (const h of houses) {
        if (houseOutputFilter(h, env.houseResearch?.(h) ?? null, data, now, ctx).location) out.add(h.id);
    }
    return out;
}

/** Does the book show the Houses chapter's locations (spec 145 T3)? On unless switched off. */
export function bookHouseMaps(options: Pick<BookOptions, 'houseMaps'>): boolean {
    return options.houseMaps !== false;
}

/**
 * The switch "House locations" (spec 145 T3): shown only for a book whose Houses chapter is in and has a house
 * whose location outputs may show; the houses it applies to.
 */
export function bookHouseMapsState(data: StromData, options: BookOptions, env: BookEnv = {}): { shown: boolean; houses: Set<HouseId> } {
    const parts = effectiveBookParts(data, options, env);
    if (!parts.houses) return { shown: false, houses: new Set() };
    const houses = housesWithLocation(data, bookChapterHousesFor(data, options, env), env);
    return { shown: houses.size > 0, houses };
}

/** The Houses chapter's houses of a book with these options (the chapter itself switched on or not). */
export function bookChapterHousesFor(data: StromData, options: BookOptions, env: BookEnv = {}): TreeHouse[] {
    const selIndex = indexOf(data, env);
    const sel = selection(selIndex, lineageSpec(options.selection, selIndex));
    return bookChapterHouses(data, sel.personIds, env.houses ?? collectHouses(data), env.finishedHouses);
}

/** The houses of the people the book's selection takes (its houses before any part is chosen). */
export function bookSelectionHouses(data: StromData, options: BookOptions, env: BookEnv = {}): TreeHouse[] {
    const selIndex = indexOf(data, env);
    const sel = selection(selIndex, lineageSpec(options.selection, selIndex));
    return bookHouses(data, sel.personIds, env.houses ?? collectHouses(data));
}

/** Every part's availability and the reason when it is not (§4.3). */
export function bookPartAvailability(data: StromData, options: BookOptions, env: BookEnv = {}): Record<BookPartKey, BookPartState> {
    const B = getStringsForLang(options.lang).book;
    const selIndex = indexOf(data, env);
    const sel = selection(selIndex, lineageSpec(options.selection, selIndex));
    const persons = sel.personIds.map(id => data.persons[id]).filter(p => !!p);
    const unions = sel.familyIds.map(id => data.partnerships[id]).filter(u => !!u);
    const hasStory = persons.some(p => !!p.story?.text?.trim()) || unions.some(u => !!u.story?.text?.trim());
    const catalog = data.sources ?? {};
    const hasSources = persons.some(p => personSourceIds(p).some(id => !!catalog[id]))
        || unions.some(u => partnershipSourceIds(u).some(id => !!catalog[id]));
    const hasMedia = Object.values(data.persons).some(p => !!p.photo)
        || unions.some(u => !!u.photo)
        || Object.values(catalog).some(s => (s.excerpts ?? []).length > 0);
    const state = (available: boolean, key: BookPartReasonKey): BookPartState =>
        ({ available, reason: available ? '' : B.unavailable[key] });
    // The Houses chapter (K7.3): the book's houses with history or above the threshold, with its page estimate.
    const treeHouses = env.houses ?? collectHouses(data);
    const chapterHouses = bookChapterHouses(data, sel.personIds, treeHouses, env.finishedHouses);
    const houses: BookPartState = chapterHouses.length
        ? { available: true, reason: '', note: B.housesNote(chapterHouses.length, Math.max(1, Math.round(housesChapterPages(chapterHouses,
            bookHouseMaps(options) ? housesWithLocation(data, chapterHouses, env) : undefined)))) }
        : state(false, 'houses');
    // The index of houses: with a house with a number among the book's people, and with the Houses chapter
    // ticked (§8); a book of a house has it on its own (K1.3: the index goes with the house selection).
    const houseCount = bookHouses(data, sel.personIds, treeHouses).length;
    const withChapter = options.selection.kind === 'house' || (options.parts.houses && houses.available);
    const houseIndex: BookPartState = !houseCount ? state(false, 'houseIndex')
        : withChapter ? { available: true, reason: '', note: B.houseIndexNote(houseCount) }
            : state(false, 'houseIndexChapter');
    return {
        toc: { available: true, reason: '' },
        tree: { available: true, reason: '' },
        families: { available: true, reason: '' },
        story: state(hasStory, 'story'),
        chart: state(options.detail !== 'brief', 'chart'),
        history: state(!!env.hasHistory, 'history'),
        sources: state(hasSources, 'sources'),
        media: state(hasMedia, 'media'),
        smallRods: state(options.selection.kind === 'tree', 'smallRods'),
        houses,
        index: { available: true, reason: '' },
        houseIndex,
    };
}

/** The parts the book is built with: ticked and available; `families` always. */
export function effectiveBookParts(data: StromData, options: BookOptions, env: BookEnv = {}): BookParts {
    const avail = bookPartAvailability(data, options, env);
    const out = {} as BookParts;
    for (const k of BOOK_PART_KEYS) out[k] = k === 'families' || (options.parts[k] && avail[k].available);
    return out;
}

function personName(data: StromData, id: PersonId): string {
    const p = data.persons[id];
    return p ? shownNameOrEmpty(p) || '?' : '?';
}

/**
 * The automatic title (§4.6): the tree's name / "Rod {label}" / "Rody {A}, {B}"
 * / "Předci: {name}" / "Potomci: {name}" in the book's language; a house by its
 * town, number and name ("Bělokamen čp. 16 · U Prouzalů").
 */
export function autoBookTitle(data: StromData, spec: BookSelectionSpec, lang: BookLang, env: BookEnv & { treeName?: string } = {}): string {
    const B = getStringsForLang(lang).book;
    switch (spec.kind) {
        case 'tree': return env.treeName?.trim() || B.title;
        case 'rods': {
            const labels = rodLabels(indexOf(data, env));
            const names = spec.rods.map(id => labels.get(id)).filter((l): l is string => !!l);
            if (!names.length) return env.treeName?.trim() || B.title;
            return names.length === 1 ? B.titleRod(names[0]) : B.titleRods(names);
        }
        case 'ancestors': return B.titleAncestors(personName(data, spec.person));
        case 'descendants': return B.titleDescendants(personName(data, spec.person));
        case 'persons': return getStringsForLang(lang).familyPages.selPersons;
        case 'gift': return B.titleGift(personName(data, spec.personId));
        case 'house': {
            // The town, the house and its name after the farm (spec 030 §8): "Bělokamen čp. 16 · U Prouzalů".
            const house = findHouse(data, spec.place, spec.house);
            return house ? houseNamedTitle(house) : `${spec.place} ${spec.house}`.trim() || B.title;
        }
    }
}

export interface BookEstimate {
    pages: number;
    persons: number;
    chapters: number;
    /** The generations the book spans (the deepest chapter's generation; 0 without chapters). */
    generations: number;
    /** The outline beside the estimate (§4.7): "Rod Fíšek · kap. 1–19", then Other families, Sources, Index. */
    outline: string[];
}

/** Pages per described person by detail (calibrated, see estimateBook). */
const PERSON_PAGES: Record<BookDetail, number> = { brief: 0.12, normal: 0.62, all: 1.25 };

/**
 * The book's size without building it (§4.7): people and families from the
 * selection, pages as a sum of per-item coefficients by detail and parts.
 * Calibrated on the analysis of 30 Oct 2026 (a tree of 835 people at Normal
 * ≈ 430 pages): a chapter's head, children and sources ≈ 0.35 page, a person
 * described ≈ 0.62 page (0.12 brief, 1.25 all), a lineage's introduction 1
 * page and its line tree 32 rows a page, prose 2800 characters a page, the
 * sources list 28 and the index 90 entries a page. Pure; < 50 ms on a
 * thousand people with a prebuilt index.
 */
export function estimateBook(data: StromData, options: BookOptions, env: BookEnv = {}): BookEstimate {
    const B = getStringsForLang(options.lang).book;
    const index = indexOf(data, env);
    const parts = effectiveBookParts(data, options, { ...env, index });
    const model = buildBookModel(data, options.selection, index);
    const chapters = model.chapters.length;
    const persons = [...model.personIds].filter(id => !data.persons[id]?.isPlaceholder).length;

    let pages = 1; // the title page
    if (parts.toc) pages += 1 + (chapters + model.groups.length) / 38;
    for (const g of model.groups) {
        pages += 1;
        if (parts.tree) pages += g.rod.memberIds.length / 32;
    }
    const described = new Set<PersonId>();
    let prose = 0;
    let notes = 0;
    const catalog = data.sources ?? {};
    const cited = new Set<string>();
    for (const ch of model.chapters) {
        const u = data.partnerships[ch.unionId];
        pages += ch.sub ? 0.2 : 0.35;
        for (const id of [u.person1Id, u.person2Id]) {
            const p = id ? data.persons[id] : undefined;
            if (!p || p.isPlaceholder || described.has(p.id)) continue;
            described.add(p.id);
            pages += PERSON_PAGES[options.detail] + (parts.chart ? 0.12 : 0);
            if (parts.story) prose += p.story?.text?.length ?? 0;
            if (options.notes) notes += p.notes?.length ?? 0;
            if (parts.sources) for (const s of personSourceIds(p)) if (catalog[s]) cited.add(s);
        }
        if (parts.story) prose += u.story?.text?.length ?? 0;
        if (parts.sources) for (const s of partnershipSourceIds(u)) if (catalog[s]) cited.add(s);
    }
    pages += prose / 2800 + notes / 3500;
    if (parts.smallRods && model.smallRods.length) pages += 0.5 + model.smallRods.length / 14;
    if (parts.sources) pages += cited.size / 28;
    if (parts.index) pages += 0.5 + persons / 90;
    // The Houses chapter (K7.3), with its maps (spec 145 T3).
    const chapterHouses = parts.houses ? bookChapterHouses(data, model.personIds, env.houses, env.finishedHouses) : [];
    pages += housesChapterPages(chapterHouses, chapterHouses.length && bookHouseMaps(options) ? housesWithLocation(data, chapterHouses, env) : undefined);
    // The index of houses: a house's head and its people, 40 rows a page.
    const houses = parts.houseIndex ? bookHouses(data, model.personIds, env.houses) : [];
    if (houses.length) pages += 0.5 + houses.reduce((n, h) => n + 1 + h.personIds.length, 0) / 40;

    const range = (list: { no: number }[]): string => list.length === 0 ? ''
        : list.length === 1 ? String(list[0].no) : `${list[0].no}–${list[list.length - 1].no}`;
    const outline: string[] = [];
    if (model.groups.length) {
        for (const g of model.groups) if (g.chapters.length) outline.push(B.outlineRod(g.label, range(g.chapters)));
    } else if (model.chapters.length) {
        outline.push(B.outlineFamilies(range(model.chapters)));
    }
    if (parts.smallRods && model.smallRods.length) outline.push(B.parts.smallRods);
    if (chapterHouses.length) outline.push(B.parts.houses);
    if (parts.sources && cited.size) outline.push(B.parts.sources);
    if (parts.index) outline.push(B.parts.index);
    if (houses.length) outline.push(B.parts.houseIndex);
    const generations = model.chapters.reduce((m, ch) => Math.max(m, ch.gen), 0);
    return { pages: Math.max(1, Math.round(pages)), persons, chapters, generations, outline };
}

/**
 * The dialog's sentence "{r} lineages and {m} other families": the lineages a
 * whole-tree book tells as chapters and the other families it lists (the
 * tree overview's count, see otherFamilyRods).
 */
export function bookRodCounts(data: StromData, env: BookEnv = {}): { rods: number; other: number } {
    const index = indexOf(data, env);
    const told = chapterRods(index);
    const toldIds = new Set(told.map(r => r.id));
    return { rods: told.length, other: otherFamilyRods(index).filter(r => !toldIds.has(r.id) && r.realMemberCount > 0).length };
}
