/**
 * What the "Give a family tree" guide remembers (spec 093 §9): per tree on
 * this device (`localStorage` key `strom.gift.{treeId}`), per person or
 * couple (the sorted ids joined), the last package's settings, when it was
 * made and how many people the cut had. Never in the tree's data or exports.
 */

import type { PersonId } from './types.js';
import type { PrivacyMode } from './privacy.js';
import {
    GIFT_CARDS, GIFT_DEFAULT_CARDS, GIFT_DEFAULT_DEPTH, GIFT_DEPTHS, defaultGiftFan, defaultGiftParts, defaultGiftPrivacy,
    type GiftCards, type GiftCut, type GiftDepth, type GiftFan, type GiftLang, type GiftLetter, type GiftMemory, type GiftParts, type GiftPrivacy, type GiftSettings,
} from './gift-tree.js';
import { FAN_STYLES } from './fan-colors.js';

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

/** The storage key of one tree's gift memory. */
export function giftMemoryKey(treeId: string): string {
    return `strom.gift.${treeId}`;
}

/** The key of a person or a couple: the ids sorted and joined, so the order of a couple does not matter. */
export function giftPersonKey(ids: readonly PersonId[]): string {
    return [...ids].sort().join('+');
}

/** The default settings of a package for `recipients` with the given letter. */
export function defaultGiftSettings(recipients: readonly PersonId[], letter: GiftLetter): GiftSettings {
    return {
        cut: { recipients: [...recipients], depth: GIFT_DEFAULT_DEPTH, branches: {} },
        privacy: defaultGiftPrivacy(),
        parts: defaultGiftParts(),
        photos: true,
        fan: defaultGiftFan(),
        cards: GIFT_DEFAULT_CARDS,
        letter: { ...letter },
    };
}

function defaultStorage(): StorageLike | null {
    try { return globalThis.localStorage ?? null; } catch { return null; }
}

const LANGS: readonly GiftLang[] = ['cs', 'en', 'de', 'pl'];
const MODES: readonly PrivacyMode[] = ['full', 'initials', 'anonymous', 'minimal'];

const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);
const str = (x: unknown, fallback: string): string => typeof x === 'string' ? x : fallback;
const bool = (x: unknown, fallback: boolean): boolean => typeof x === 'boolean' ? x : fallback;

function flags<T extends object>(raw: unknown, fallback: T): T {
    const out = { ...fallback };
    if (!isObj(raw)) return out;
    for (const key of Object.keys(fallback) as (keyof T)[]) {
        const v = raw[key as string];
        if (typeof v === 'boolean') (out as Record<keyof T, unknown>)[key] = v;
    }
    return out;
}

function parseCut(raw: unknown, recipients: readonly PersonId[]): GiftCut {
    const o = isObj(raw) ? raw : {};
    const depth = GIFT_DEPTHS.includes(o.depth as GiftDepth) ? o.depth as GiftDepth : GIFT_DEFAULT_DEPTH;
    const branches: Record<PersonId, boolean> = {};
    if (isObj(o.branches)) for (const [id, on] of Object.entries(o.branches)) if (typeof on === 'boolean') branches[id as PersonId] = on;
    return { recipients: [...recipients], depth, branches };
}

function parsePrivacy(raw: unknown): GiftPrivacy {
    const d = defaultGiftPrivacy();
    if (!isObj(raw)) return d;
    return {
        others: MODES.includes(raw.others as PrivacyMode) ? raw.others as PrivacyMode : d.others,
        fullIds: Array.isArray(raw.fullIds) ? raw.fullIds.filter((x): x is PersonId => typeof x === 'string') : [],
        sensitive: flags(raw.sensitive, d.sensitive),
        // An entry from before K6.5 has one set: it stays the set of those shown in full, the others take the defaults.
        othersSensitive: flags(raw.othersSensitive, d.othersSensitive),
        dead: flags(raw.dead, d.dead),
    };
}

/** The fan's choices (K5.6): the valid styles in their order, none valid → Antique; an entry from before K5.6 takes the defaults. */
export function parseGiftFan(raw: unknown): GiftFan {
    const d = defaultGiftFan();
    if (!isObj(raw)) return d;
    const listed = Array.isArray(raw.styles) ? raw.styles : [];
    const styles = FAN_STYLES.filter(st => listed.includes(st));
    return { asTree: bool(raw.asTree, d.asTree), styles: styles.length ? styles : d.styles, photos: bool(raw.photos, d.photos) };
}

function parseCards(raw: unknown): GiftCards {
    return GIFT_CARDS.includes(raw as GiftCards) ? raw as GiftCards : GIFT_DEFAULT_CARDS;
}

function parseLetter(raw: unknown): GiftLetter {
    const o = isObj(raw) ? raw : {};
    return {
        lang: LANGS.includes(o.lang as GiftLang) ? o.lang as GiftLang : 'en',
        motif: o.motif === 'xmas' ? 'xmas' : 'none',
        salutation: str(o.salutation, ''),
        message: str(o.message, ''),
        signature: str(o.signature, ''),
        date: str(o.date, ''),
    };
}

/**
 * One stored entry, each part checked on its own (a missing or malformed
 * field takes its default), or null when it is not an entry at all. The
 * recipients come from the key, never from the stored value.
 */
export function parseGiftMemory(raw: unknown, recipients: readonly PersonId[]): GiftMemory | null {
    if (!isObj(raw) || typeof raw.lastAt !== 'string' || !isObj(raw.settings)) return null;
    const s = raw.settings;
    const settings: GiftSettings = {
        cut: parseCut(s.cut, recipients),
        privacy: parsePrivacy(s.privacy),
        parts: flags<GiftParts>(s.parts, defaultGiftParts()),
        photos: bool(s.photos, true),
        fan: parseGiftFan(s.fan),
        cards: parseCards(s.cards),
        letter: parseLetter(s.letter),
        ...(typeof s.fileName === 'string' && s.fileName ? { fileName: s.fileName } : {}),
    };
    const cutSize = typeof raw.cutSize === 'number' && Number.isFinite(raw.cutSize) ? raw.cutSize : 0;
    return { lastAt: raw.lastAt, ...(typeof raw.madeAt === 'string' && raw.madeAt ? { madeAt: raw.madeAt } : {}), settings, cutSize };
}

function readAll(storage: StorageLike, treeId: string): Record<string, unknown> {
    const raw = storage.getItem(giftMemoryKey(treeId));
    if (!raw) return {};
    try {
        const v: unknown = JSON.parse(raw);
        return isObj(v) ? v : {};
    } catch { return {}; }
}

/** The memory of a person or couple (`key` from giftPersonKey), or null (nothing stored, storage unavailable or unreadable). */
export function loadGiftMemory(treeId: string | null | undefined, key: string, storage: StorageLike | null = defaultStorage()): GiftMemory | null {
    if (!storage || !treeId || !key) return null;
    try {
        return parseGiftMemory(readAll(storage, treeId)[key], key.split('+') as PersonId[]);
    } catch { return null; }
}

/** Remember a person's or couple's settings in this tree; storage errors are swallowed (not kept). */
export function saveGiftMemory(treeId: string | null | undefined, key: string, memory: GiftMemory, storage: StorageLike | null = defaultStorage()): void {
    if (!storage || !treeId || !key) return;
    try {
        const all = readAll(storage, treeId);
        all[key] = memory;
        storage.setItem(giftMemoryKey(treeId), JSON.stringify(all));
    } catch { /* not kept */ }
}
