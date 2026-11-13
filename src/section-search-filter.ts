/**
 * A section of the Research overview searched here (spec 083 §1, §2): the
 * index of its items (built when its data changes, never while typing), what
 * the typed words find among them, the counts of its kind chips, what of it
 * is folded while searching, and the selection outside the search. Pure: the
 * sections (Awaiting action, What the research knows) draw it.
 */

import { matchDoc, type SearchDoc, type SearchHit, type SearchToken } from './section-search-match.js';

/** A section's items with their search documents, in the items' order. */
export interface SearchIndex<T> {
    readonly items: readonly T[];
    readonly docs: readonly SearchDoc[];
    /** What else the documents were made from (the language, the people): another value builds them again. */
    readonly stamp: readonly unknown[];
}

const sameStamp = (a: readonly unknown[], b: readonly unknown[]): boolean =>
    a.length === b.length && a.every((x, i) => Object.is(x, b[i]));

/**
 * The index of `items`: the previous one while the items (the same list) and
 * the stamp are the same, else built anew, one document per item.
 */
export function searchIndex<T>(prev: SearchIndex<T> | null, items: readonly T[], stamp: readonly unknown[],
    docOf: (item: T) => SearchDoc): SearchIndex<T> {
    if (prev && prev.items === items && sameStamp(prev.stamp, stamp)) return prev;
    return { items, docs: items.map(docOf), stamp: [...stamp] };
}

/** What a section's search finds. */
export interface SectionSearchResult<T, K extends string> {
    /** Words are typed (else everything is found and nothing of the search is shown). */
    searching: boolean;
    /** Every item found, in the section's order. */
    matched: T[];
    /** What matched an item by its number (the row's amber tag); `{}`: text only. */
    hits: Map<T, SearchHit>;
    /** The items found of each kind (a chip's count while searching). */
    counts: Map<K, number>;
    /** The items found under the chosen chip. */
    shown: T[];
    /** The items under the chosen chip without the search ("Found n of m": m). */
    total: number;
}

/**
 * Search the section: each item matches every word (`matchDoc`); its kind
 * (`kindOf`) counts it for its chip, `chosen` ('all' or a kind) narrows what
 * is shown. No words: everything is found.
 */
export function searchSection<T, K extends string>(index: SearchIndex<T>, toks: readonly SearchToken[],
    kindOf: (item: T) => K, chosen: K | 'all'): SectionSearchResult<T, K> {
    const searching = toks.length > 0;
    const matched: T[] = [];
    const hits = new Map<T, SearchHit>();
    const counts = new Map<K, number>();
    const shown: T[] = [];
    let total = 0;
    index.items.forEach((item, i) => {
        const kind = kindOf(item);
        const inChip = chosen === 'all' || kind === chosen;
        if (inChip) total++;
        const hit = searching ? matchDoc(index.docs[i], toks) : {};
        if (!hit) return;
        matched.push(item);
        hits.set(item, hit);
        counts.set(kind, (counts.get(kind) ?? 0) + 1);
        if (inChip) shown.push(item);
    });
    return { searching, matched, hits, counts, shown, total };
}

/** A chip's count: what was found of its kind while searching ('all': everything found), else `plain`. */
export function chipCount<T, K extends string>(res: SectionSearchResult<T, K>, kind: K | 'all', plain: number): number {
    if (!res.searching) return plain;
    return kind === 'all' ? res.matched.length : res.counts.get(kind) ?? 0;
}

/**
 * Whether a phase or group of a section is open: while searching, as folded
 * during the search (`searchOpen`, open unless folded); else as chosen by
 * hand (`manual`), else its default.
 */
export function sectionPartOpen(key: string, byDefault: boolean, searching: boolean,
    manual: ReadonlyMap<string, boolean>, searchOpen: ReadonlyMap<string, boolean> | null | undefined): boolean {
    return searching ? searchOpen?.get(key) ?? true : manual.get(key) ?? byDefault;
}

/** Fold or unfold a phase or group: during a search only for the search, else by hand (it lasts). */
export function toggleSectionPart(key: string, open: boolean, searching: boolean,
    manual: Map<string, boolean>, searchOpen: Map<string, boolean> | null | undefined): void {
    if (searching && searchOpen) searchOpen.set(key, !open);
    else manual.set(key, !open);
}

/** The picked ones the search does not show (they stay picked; the foot says how many). */
export function selectedOutside(selected: Iterable<string>, found: ReadonlySet<string>): string[] {
    return [...selected].filter(id => !found.has(id));
}

/** The box of a list's bulk head: none, some or all of `ids` (the ones it is about) picked. */
export type BulkBoxState = 'none' | 'some' | 'all';

/**
 * The bulk head's box (empty / – / ✓): counted only over `ids`, the found
 * ones with a proposal while searching (the picked ones outside do not count).
 */
export function bulkBoxState(ids: readonly string[], selected: ReadonlySet<string>): BulkBoxState {
    const n = ids.filter(id => selected.has(id)).length;
    return n === 0 ? 'none' : n === ids.length ? 'all' : 'some';
}

/**
 * The overview's sheet with the phone's keyboard up: as high as what is
 * visible of the page (`visualViewport`), from its top, so what is found
 * stands between the field and the keyboard; null when nothing covers the
 * page (the sheet keeps its own size).
 */
export function sheetOverKeyboard(vv: { height: number; offsetTop: number } | null | undefined,
    innerHeight: number): { top: number; height: number } | null {
    if (!vv || !(vv.height > 0) || vv.height >= innerHeight - 1) return null;
    return { top: Math.max(0, Math.round(vv.offsetTop)), height: Math.round(vv.height) };
}
