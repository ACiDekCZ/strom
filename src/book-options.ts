/**
 * The family book's options (1031 §4): the choice of people, the parts, the
 * detail per person, the presets, the automatic title and the page estimate.
 * Pure. The book's options never read or change the person card's settings
 * or `lifelineDefaults` (§4.3).
 */

import { PersonId, StromData, personSourceIds, partnershipSourceIds } from './types.js';
import { PrivacyMode } from './privacy.js';
import { getStringsForLang } from './strings.js';
import { yearOf } from './dates.js';
import { shownNameOrEmpty } from './person-name.js';
import { LineageIndex, buildLineages, otherFamilyRods, rodLabels, selection } from './lineage.js';
import { BookSelectionSpec, buildBookModel, chapterRods, lineageSpec } from './book-model.js';

export type { BookSelectionSpec } from './book-model.js';

export type BookLang = 'cs' | 'en' | 'de';
export type BookDetail = 'brief' | 'normal' | 'all';
export type BookPreset = 'family' | 'research' | 'custom';

/** The parts in the order of the dialog and the book; `houses` (P3) will follow `smallRods`. */
export const BOOK_PART_KEYS = ['toc', 'tree', 'families', 'story', 'chart', 'history', 'sources', 'media', 'smallRods', 'index'] as const;
export type BookPartKey = typeof BOOK_PART_KEYS[number];
export type BookParts = Record<BookPartKey, boolean>;

/** Parts that can be unavailable, with the reason the dialog shows (§4.3). */
export type BookPartReasonKey = 'story' | 'chart' | 'history' | 'sources' | 'media' | 'smallRods';

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
}

export interface BookPartState {
    available: boolean;
    /** Why not, in the book's language ('' when available). */
    reason: string;
}

/** The defaults: the whole tree, "For the family", privacy initials + birth year (§4.6, §4.7). */
export function defaultBookOptions(lang: BookLang): BookOptions {
    const parts = Object.fromEntries(BOOK_PART_KEYS.map(k => [k, true])) as BookParts;
    return { selection: { kind: 'tree' }, parts, detail: 'normal', notes: false, research: false, privacy: 'initials', lang };
}

/** A preset applied (§4.7); 'custom' changes nothing. */
export function applyBookPreset(options: BookOptions, preset: BookPreset): BookOptions {
    if (preset === 'custom') return options;
    const parts = Object.fromEntries(BOOK_PART_KEYS.map(k => [k, true])) as BookParts;
    return preset === 'family'
        ? { ...options, parts, detail: 'normal', notes: false, research: false }
        : { ...options, parts, detail: 'all', notes: true, research: true };
}

/** The preset the options match; any other combination is 'custom'. */
export function bookPresetOf(options: Pick<BookOptions, 'parts' | 'detail' | 'notes' | 'research'>): BookPreset {
    const allParts = BOOK_PART_KEYS.every(k => options.parts[k] || k === 'families');
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
}

function indexOf(data: StromData, env: BookEnv): LineageIndex {
    return env.index && env.index.data === data ? env.index : buildLineages(data);
}

/** Every part's availability and the reason when it is not (§4.3). */
export function bookPartAvailability(data: StromData, options: BookOptions, env: BookEnv = {}): Record<BookPartKey, BookPartState> {
    const B = getStringsForLang(options.lang).book;
    const sel = selection(indexOf(data, env), lineageSpec(options.selection));
    const persons = sel.personIds.map(id => data.persons[id]).filter(p => !!p);
    const unions = sel.familyIds.map(id => data.partnerships[id]).filter(u => !!u);
    const hasStory = persons.some(p => !!p.story?.text?.trim()) || unions.some(u => !!u.story?.text?.trim());
    const catalog = data.sources ?? {};
    const hasSources = persons.some(p => personSourceIds(p).some(id => !!catalog[id]))
        || unions.some(u => partnershipSourceIds(u).some(id => !!catalog[id]));
    const hasMedia = Object.values(data.persons).some(p => !!p.photo)
        || Object.values(catalog).some(s => (s.excerpts ?? []).length > 0);
    const state = (available: boolean, key: BookPartReasonKey): BookPartState =>
        ({ available, reason: available ? '' : B.unavailable[key] });
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
        index: { available: true, reason: '' },
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
 * / "Předci: {name}" / "Potomci: {name}" in the book's language.
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
    }
}

/** The subtitle's span "{from}–{to}" over the chosen people's dated records ('' without dates). */
export function bookPeriod(data: StromData, spec: BookSelectionSpec, env: BookEnv = {}): string {
    const sel = selection(indexOf(data, env), lineageSpec(spec));
    let from = Infinity, to = -Infinity;
    const see = (date: string | undefined): void => {
        const y = yearOf(date);
        if (y === null) return;
        if (y < from) from = y;
        if (y > to) to = y;
    };
    for (const id of sel.personIds) {
        const p = data.persons[id];
        if (!p || p.isPlaceholder) continue;
        see(p.birthDate);
        see(p.deathDate);
    }
    for (const id of sel.familyIds) see(data.partnerships[id]?.startDate);
    if (from === Infinity) return '';
    return from === to ? String(from) : `${from}–${to}`;
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

    const range = (list: { no: number }[]): string => list.length === 0 ? ''
        : list.length === 1 ? String(list[0].no) : `${list[0].no}–${list[list.length - 1].no}`;
    const outline: string[] = [];
    if (model.groups.length) {
        for (const g of model.groups) if (g.chapters.length) outline.push(B.outlineRod(g.label, range(g.chapters)));
    } else if (model.chapters.length) {
        outline.push(B.outlineFamilies(range(model.chapters)));
    }
    if (parts.smallRods && model.smallRods.length) outline.push(B.parts.smallRods);
    if (parts.sources && cited.size) outline.push(B.parts.sources);
    if (parts.index) outline.push(B.parts.index);
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
