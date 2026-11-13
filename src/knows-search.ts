/**
 * What the research knows searched in the Research overview (spec 083 §2):
 * each row (an open conflict or a hypothesis) is searched by what its row
 * says. A conflict by its person (name and P…), its fact and its values (a
 * year like "1841" as text); a hypothesis by its person, its title and its
 * H…. The index is built when the rows say something else, not
 * at each key.
 */

import { foldSearch2, idNumber, type SearchDoc } from './section-search-match.js';
import { searchIndex, type SearchIndex } from './section-search-filter.js';

/** A row of What the research knows as searched. */
export interface KnowsSearchRow {
    /** The row's key, unique in the section (the conflict's or hypothesis's id, else made up). */
    key: string;
    conflict: boolean;
    /** The person's name. */
    name: string;
    /** The person's P… in the research (null: none). */
    personRef: string | null;
    /** A conflict: its fact and values; a hypothesis: its title, as its row says them. */
    words: readonly string[];
    /** A hypothesis's H… (none for a conflict). */
    hypoId?: string;
}

/** The text a row is searched by, before folding (the same text: the same document). */
export function knowsSearchSource(r: KnowsSearchRow): string {
    return [r.name, r.personRef, ...r.words, r.conflict ? '' : r.hypoId].filter(Boolean).join(' ');
}

/** The search document of a row: its text folded, its person's number, a hypothesis's number. */
export function knowsSearchDoc(r: KnowsSearchRow): SearchDoc {
    return {
        hay: foldSearch2(knowsSearchSource(r)),
        pn: idNumber(r.personRef),
        ...(r.conflict ? {} : { hn: idNumber(r.hypoId) }),
    };
}

/** The section's index: the rows' keys with their documents, and what they were made from. */
export interface KnowsIndex {
    /** Every row's text, joined: the same text, the same index. */
    readonly sig: string;
    readonly index: SearchIndex<string>;
}

/**
 * The index of the rows: the previous one while they say the same (typing,
 * a redraw), else built anew (a conflict decided, a hypothesis accepted, a
 * name changed, another language).
 */
export function knowsSearchIndex(prev: KnowsIndex | null, rows: readonly KnowsSearchRow[], lang: string): KnowsIndex {
    const sig = rows.map(r => `${r.key}\u0001${knowsSearchSource(r)}`).join('\u0002');
    const keys = prev && prev.sig === sig ? prev.index.items : rows.map(r => r.key);
    const byKey = new Map(rows.map(r => [r.key, r]));
    return { sig, index: searchIndex(prev?.index ?? null, keys, [lang], key => knowsSearchDoc(byKey.get(key)!)) };
}
