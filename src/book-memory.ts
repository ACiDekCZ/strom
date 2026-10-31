/**
 * The family book dialog's memory and its entry rules (1031 §4.8).
 *
 * Remembered per tree on this device (`localStorage` key `strom.book.{treeId}`):
 * the preset, the parts, the detail, notes, researcher data, privacy and the
 * book's language — plus the last choice of lineages, which the menu entry
 * offers again while those lineages still exist. Never remembered: the
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
    /** The last lineages chosen (kind 'rods'), offered again from the menu. */
    lastRods?: RodId[];
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
    if (o.parts && typeof o.parts === 'object' && !Array.isArray(o.parts)) {
        const src = o.parts as Record<string, unknown>;
        const parts = {} as BookParts;
        let any = false;
        for (const k of BOOK_PART_KEYS) {
            if (typeof src[k] === 'boolean') { parts[k] = src[k] as boolean; any = true; }
        }
        if (any) out.parts = parts;
    }
    if (Array.isArray(o.lastRods)) {
        const ids = o.lastRods.filter((x): x is RodId => typeof x === 'string' && x.length > 0);
        if (ids.length) out.lastRods = ids;
    }
    return Object.keys(out).length ? out : null;
}

/** This tree's memory, or null (nothing stored, storage unavailable or unreadable). */
export function loadBookMemory(storage: StorageLike | null | undefined, treeId: string | null | undefined): Partial<BookMemory> | null {
    if (!storage || !treeId) return null;
    try { return parseBookMemory(storage.getItem(bookMemoryKey(treeId))); } catch { return null; }
}

/**
 * Remember the options for this tree: everything but the selection and the
 * title. A choice of lineages becomes `lastRods`; another kind of selection
 * keeps the previous `lastRods`. Storage errors are swallowed (not kept).
 */
export function saveBookMemory(storage: StorageLike | null | undefined, treeId: string | null | undefined, options: BookOptions): void {
    if (!storage || !treeId) return;
    try {
        const prev = loadBookMemory(storage, treeId);
        const lastRods = options.selection.kind === 'rods' && options.selection.rods.length
            ? [...options.selection.rods] : prev?.lastRods;
        const memory: BookMemory = {
            preset: bookPresetOf(options),
            parts: { ...options.parts },
            detail: options.detail,
            notes: options.notes,
            research: options.research,
            privacy: options.privacy,
            lang: options.lang,
            ...(lastRods?.length ? { lastRods } : {}),
        };
        storage.setItem(bookMemoryKey(treeId), JSON.stringify(memory));
    } catch { /* not kept */ }
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
