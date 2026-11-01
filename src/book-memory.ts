/**
 * The family book dialog's memory and its entry rules (1031 §4.8).
 *
 * Remembered per tree on this device (`localStorage` key `strom.book.{treeId}`):
 * the preset, the parts, the detail, notes, researcher data, privacy and the
 * book's language, the Custom preset's own values (§4.9) — plus the last choice of lineages, which the menu entry
 * offers again while those lineages still exist, the output (the book or
 * the linked family pages, spec 026 §6.6) and the pages' own choices
 * (families, images, what they include). Never remembered: the
 * selection itself (whole tree, ancestors, descendants, the person) and the
 * title. The book's options never touch the person card's settings or
 * `lifelineDefaults`: this module writes its own key and nothing else.
 *
 * Pure apart from the storage handed in (tests pass a fake one).
 */

import { PersonId } from './types.js';
import { PrivacyMode } from './privacy.js';
import { LineageIndex, RodId } from './lineage.js';
import { chapterRods } from './book-model.js';
import { ImageChoice } from './image-registry.js';
import type { BookPresetValues } from './book-preset.js';
import {
    BOOK_PART_KEYS, BookDetail, BookLang, BookOptions, BookParts, BookPreset, BookSelectionSpec,
    applyBookPreset, bookPresetOf, defaultBookOptions,
} from './book-options.js';

/** The generations of a book of ancestors or descendants (§4.2): 1–12, 4 by default. */
export const BOOK_GENERATIONS_MIN = 1;
export const BOOK_GENERATIONS_MAX = 12;
export const BOOK_GENERATIONS_DEFAULT = 4;

/** What one tree's book dialog remembers. */
export interface BookMemory {
    preset: BookPreset;
    parts: BookParts;
    detail: BookDetail;
    notes: boolean;
    research: boolean;
    privacy: PrivacyMode;
    lang: BookLang;
    /** The Custom preset's own values (§4.9), null before Custom is first chosen. */
    custom?: BookPresetValues | null;
    /** The last lineages chosen (kind 'rods'), offered again from the menu. */
    lastRods?: RodId[];
    /** The dialog's output: the book to print or the linked family pages (spec 026 §6.1). */
    output?: BookOutput;
    /** The family pages' own choices (§6.2). */
    pages?: PagesChoices;
}

export type BookOutput = 'book' | 'pages';

/** What the family pages include besides the pages themselves (§6.2). */
export interface PagesInclude { map: boolean; sources: boolean; stories: boolean }

/** The family pages' rows of the dialog (§6.2). */
export interface PagesChoices {
    families: 'pages' | 'section';
    clips: ImageChoice;
    photos: ImageChoice;
    include: PagesInclude;
}

/** The pages' rows when nothing is remembered: families as pages where it makes sense, images as they are, everything in. */
export function defaultPagesChoices(): PagesChoices {
    return { families: 'pages', clips: 'full', photos: 'full', include: { map: true, sources: true, stories: true } };
}

/** How the dialog was opened (§4.8): the entry decides the first selection. */
export type BookEntry =
    | { kind: 'menu' }
    | { kind: 'rods'; rods: readonly RodId[] }
    | { kind: 'person'; person: PersonId };

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

export function bookMemoryKey(treeId: string): string {
    return `strom.book.${treeId}`;
}

const LANGS: readonly BookLang[] = ['cs', 'en', 'de'];
const DETAILS: readonly BookDetail[] = ['brief', 'normal', 'all'];
const PRESETS: readonly BookPreset[] = ['family', 'research', 'custom'];
const PRIVACY: readonly PrivacyMode[] = ['full', 'initials', 'minimal', 'anonymous'];
const OUTPUTS: readonly BookOutput[] = ['book', 'pages'];
const FAMILIES: readonly PagesChoices['families'][] = ['pages', 'section'];
const IMAGES: readonly ImageChoice[] = ['full', 'small', 'none'];
const INCLUDE_KEYS: readonly (keyof PagesInclude)[] = ['map', 'sources', 'stories'];

function oneOf<T extends string>(list: readonly T[], x: unknown): T | undefined {
    return typeof x === 'string' && (list as readonly string[]).includes(x) ? x as T : undefined;
}

/**
 * The remembered fields of a stored entry, each checked on its own: a field
 * that is missing or malformed is left out (the default stands), so an old or
 * damaged entry never breaks the dialog. Null when nothing usable is stored.
 */
export function parseBookMemory(raw: string | null | undefined): Partial<BookMemory> | null {
    if (!raw) return null;
    let v: unknown;
    try { v = JSON.parse(raw); } catch { return null; }
    if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
    const o = v as Record<string, unknown>;
    const out: Partial<BookMemory> = {};
    const preset = oneOf(PRESETS, o.preset);
    if (preset) out.preset = preset;
    const detail = oneOf(DETAILS, o.detail);
    if (detail) out.detail = detail;
    const privacy = oneOf(PRIVACY, o.privacy);
    if (privacy) out.privacy = privacy;
    const lang = oneOf(LANGS, o.lang);
    if (lang) out.lang = lang;
    if (typeof o.notes === 'boolean') out.notes = o.notes;
    if (typeof o.research === 'boolean') out.research = o.research;
    const parts = parseParts(o.parts);
    if (parts) out.parts = parts as BookParts;
    if (o.custom === null) out.custom = null;
    else {
        const custom = parseCustom(o.custom);
        if (custom) out.custom = custom;
    }
    // An entry from before Custom kept its own values: Custom's are the ones stored.
    if (out.preset === 'custom' && !out.custom) {
        out.custom = {
            detail: out.detail ?? 'normal', notes: out.notes ?? false, research: out.research ?? false,
            parts: { ...allParts(), ...out.parts, families: true },
        };
    }
    if (Array.isArray(o.lastRods)) {
        const ids = o.lastRods.filter((x): x is RodId => typeof x === 'string' && x.length > 0);
        if (ids.length) out.lastRods = ids;
    }
    const output = oneOf(OUTPUTS, o.output);
    if (output) out.output = output;
    const pages = parsePagesChoices(o.pages);
    if (pages) out.pages = pages;
    return Object.keys(out).length ? out : null;
}

/** The stored parts that are booleans; null when none is. */
function parseParts(v: unknown): Partial<BookParts> | null {
    if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
    const src = v as Record<string, unknown>;
    const parts: Partial<BookParts> = {};
    let any = false;
    for (const k of BOOK_PART_KEYS) {
        if (typeof src[k] === 'boolean') { parts[k] = src[k] as boolean; any = true; }
    }
    return any ? parts : null;
}

function allParts(): BookParts {
    return Object.fromEntries(BOOK_PART_KEYS.map(k => [k, true])) as BookParts;
}

/** Custom's stored values: the detail and both switches must be there; a missing part counts as ticked. */
function parseCustom(v: unknown): BookPresetValues | null {
    if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
    const o = v as Record<string, unknown>;
    const detail = oneOf(DETAILS, o.detail);
    if (!detail || typeof o.notes !== 'boolean' || typeof o.research !== 'boolean') return null;
    return { detail, notes: o.notes, research: o.research, parts: { ...allParts(), ...parseParts(o.parts), families: true } };
}

/** The pages' choices of a stored entry, each field checked on its own over the defaults; null when none is usable. */
function parsePagesChoices(v: unknown): PagesChoices | null {
    if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
    const o = v as Record<string, unknown>;
    const out = defaultPagesChoices();
    let any = false;
    const families = oneOf(FAMILIES, o.families);
    if (families) { out.families = families; any = true; }
    const clips = oneOf(IMAGES, o.clips);
    if (clips) { out.clips = clips; any = true; }
    const photos = oneOf(IMAGES, o.photos);
    if (photos) { out.photos = photos; any = true; }
    if (o.include && typeof o.include === 'object' && !Array.isArray(o.include)) {
        const src = o.include as Record<string, unknown>;
        for (const k of INCLUDE_KEYS) if (typeof src[k] === 'boolean') { out.include[k] = src[k] as boolean; any = true; }
    }
    return any ? out : null;
}

/** This tree's memory, or null (nothing stored, storage unavailable or unreadable). */
export function loadBookMemory(storage: StorageLike | null | undefined, treeId: string | null | undefined): Partial<BookMemory> | null {
    if (!storage || !treeId) return null;
    try { return parseBookMemory(storage.getItem(bookMemoryKey(treeId))); } catch { return null; }
}

/**
 * Remember the options for this tree: everything but the selection and the
 * title. The preset, when not given, is the one the options match; Custom's
 * values, the output and the pages' choices, when not given, stay as stored. A choice of lineages becomes `lastRods`; another kind of selection
 * keeps the previous `lastRods`. Storage errors are swallowed (not kept).
 */
export function saveBookMemory(
    storage: StorageLike | null | undefined, treeId: string | null | undefined, options: BookOptions,
    extra: { output?: BookOutput; pages?: PagesChoices; preset?: BookPreset; custom?: BookPresetValues | null } = {},
): void {
    if (!storage || !treeId) return;
    try {
        const prev = loadBookMemory(storage, treeId);
        const lastRods = options.selection.kind === 'rods' && options.selection.rods.length
            ? [...options.selection.rods] : prev?.lastRods;
        const custom = extra.custom !== undefined ? extra.custom : prev?.custom;
        const memory: BookMemory = {
            preset: extra.preset ?? bookPresetOf(options),
            parts: { ...options.parts },
            detail: options.detail,
            notes: options.notes,
            research: options.research,
            privacy: options.privacy,
            lang: options.lang,
            ...(custom !== undefined ? { custom: custom ? { ...custom, parts: { ...custom.parts } } : null } : {}),
            ...(lastRods?.length ? { lastRods } : {}),
            ...((extra.output ?? prev?.output) ? { output: extra.output ?? prev?.output } : {}),
            ...((extra.pages ?? prev?.pages) ? { pages: clonePages((extra.pages ?? prev?.pages)!) } : {}),
        };
        storage.setItem(bookMemoryKey(treeId), JSON.stringify(memory));
    } catch { /* not kept */ }
}

function clonePages(p: PagesChoices): PagesChoices {
    return { ...p, include: { ...p.include } };
}

/** The pages' choices on opening: the remembered ones, else the defaults. */
export function pagesChoicesFromMemory(memory: Partial<BookMemory> | null): PagesChoices {
    return memory?.pages ? clonePages(memory.pages) : defaultPagesChoices();
}

/**
 * The dialog's options on opening: the defaults (§4.6, §4.7), the remembered
 * fields over them, the entry's selection, no title (automatic). A remembered
 * preset without its parts (an entry cut short) is applied as a preset.
 */
export function bookOptionsFromMemory(appLang: BookLang, memory: Partial<BookMemory> | null, selection: BookSelectionSpec): BookOptions {
    let base = defaultBookOptions(memory?.lang ?? appLang);
    if (memory?.preset && memory.preset !== 'custom' && !memory.parts) base = applyBookPreset(base, memory.preset);
    return {
        ...base,
        ...(memory?.parts ? { parts: { ...base.parts, ...memory.parts, families: true } } : {}),
        ...(memory?.detail ? { detail: memory.detail } : {}),
        ...(memory?.notes !== undefined ? { notes: memory.notes } : {}),
        ...(memory?.research !== undefined ? { research: memory.research } : {}),
        ...(memory?.privacy ? { privacy: memory.privacy } : {}),
        selection,
    };
}

/** The lineages a book of lineages can choose from (§4.2: small ones are not listed). */
export function bookRodChoices(index: LineageIndex): RodId[] {
    return chapterRods(index).map(r => r.id);
}

/**
 * The first selection by entry (§4.8): from a lineage → that lineage; from a
 * person → their descendants, 4 generations; from the menu, Export or the
 * bottom sheet → the last lineages chosen when they all still exist (as
 * lineages a book can choose), else the whole tree.
 */
export function bookEntrySelection(entry: BookEntry, index: LineageIndex, lastRods?: readonly RodId[]): BookSelectionSpec {
    switch (entry.kind) {
        case 'rods': return { kind: 'rods', rods: [...entry.rods] };
        case 'person': return { kind: 'descendants', person: entry.person, generations: BOOK_GENERATIONS_DEFAULT };
        case 'menu': {
            const choosable = new Set(bookRodChoices(index));
            if (lastRods?.length && lastRods.every(id => choosable.has(id))) return { kind: 'rods', rods: [...lastRods] };
            return { kind: 'tree' };
        }
    }
}

/** Generations clamped to 1–12. */
export function clampBookGenerations(n: number): number {
    if (!Number.isFinite(n)) return BOOK_GENERATIONS_DEFAULT;
    return Math.min(BOOK_GENERATIONS_MAX, Math.max(BOOK_GENERATIONS_MIN, Math.round(n)));
}
