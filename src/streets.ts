/**
 * Streets and house numbers in place names — the rules of Strom Research
 * (`strom-research/src/core/streets.ts`), ported so the app reads a place the
 * same way the research does. A street is no place: the place of a fact is the
 * municipality ("Lhota", "Lhota, okres Horní"), the street and the house number
 * are its house ("Dlouhá 12", "16").
 *
 * The words that tell a street or a house number are data (src/terms/streets.json,
 * a byte-identical copy of the research's assets/terms/streets.json), never code;
 * they are compared folded (foldText), word by word, in any script. The shared
 * cases (test/fixtures/streets/cases.json, the research's copy) keep the port
 * in step: the research changes the rules, the app copies both files and its
 * test shows what the port has to catch up with.
 *
 * Pure functions, no I/O. Every input is NFC-normalized first.
 */

import streetsFile from './terms/streets.json' with { type: 'json' };

interface TermsFile {
    words?: Record<string, string[]>;
    suffixes?: string[];
    last?: string[];
    house?: string[];
    numbered?: string[];
}

interface Terms {
    words: Set<string>;
    suffixes: string[];
    last: Set<string>;
    /** Each marker of a house number as its folded words ("č. p." → ["c.", "p."]), the longest first. */
    house: string[][];
    /** Municipalities whose number after the name is a part of them ("Praha 5"), folded. */
    numbered: Set<string>;
}

/** A word as written: letters, marks and numbers, a dot at its end kept ("č.", "nám."); "№" a word of its own. */
const TOKEN = /[\p{L}\p{M}\p{N}]+\.?|№/gu;
/** A house number: digits, a letter after them ("12", "12a", "3."). */
const NUMBER = /^\p{N}+\p{L}?\.?$/u;
const LETTER = /\p{L}/u;

/**
 * Lowercase, strip diacritics, collapse whitespace: "Víšek  Antonín" → "visek antonin".
 * The research's foldText (src/core/text.ts): letters without a decomposition
 * (ß, ł, đ, ø, æ, œ, þ) are spelled out.
 */
export function foldText(s: string): string {
    return s
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/ß/g, 'ss')
        .replace(/[łŁ]/g, 'l')
        .replace(/[đĐ]/g, 'd')
        .replace(/[øØ]/g, 'o')
        .replace(/[æÆ]/g, 'ae')
        .replace(/[œŒ]/g, 'oe')
        .replace(/[þÞ]/g, 'th')
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .trim();
}

let terms: Terms | undefined;

/** The words of streets.json, folded once. */
function streetTerms(): Terms {
    if (terms) return terms;
    const f = streetsFile as TermsFile;
    const words = (s: string): string[] => [...foldText(s).matchAll(TOKEN)].map(m => m[0]);
    terms = {
        words: new Set(Object.values(f.words ?? {}).flat().map(w => foldText(w))),
        suffixes: (f.suffixes ?? []).map(w => foldText(w)),
        last: new Set((f.last ?? []).map(w => foldText(w))),
        house: (f.house ?? []).map(words).filter(w => w.length).sort((a, b) => b.length - a.length),
        numbered: new Set((f.numbered ?? []).map(w => foldText(w))),
    };
    return terms;
}

/** One word of a text: folded, and where it stands in the text. */
export interface Tok {
    fold: string;
    start: number;
    end: number;
}

/** The words of a text (TOKEN), folded, with their positions. */
export function tokens(text: string): Tok[] {
    return [...text.matchAll(TOKEN)].map(m => ({ fold: foldText(m[0]), start: m.index!, end: m.index! + m[0].length }));
}

/** How many words a marker of a house number takes at `i` ("č. p." two), 0 where none stands. */
export function markerAt(toks: readonly Tok[], i: number): number {
    for (const m of streetTerms().house) if (m.every((w, k) => toks[i + k]?.fold === w)) return m.length;
    return 0;
}

/** A word that is a house number ("12", "12a", "3."). */
export const isNumberTok = (t: Tok | undefined): boolean => !!t && NUMBER.test(t.fold);

/** A house of numbers alone ("12", "13/2"). */
export function numbersOnly(text: string): boolean {
    const toks = tokens(text.normalize('NFC'));
    return toks.length > 0 && toks.every(isNumberTok);
}

/**
 * Where a house number begins at the end of a part (its marker, or the numbers
 * alone): `at` = index of its first word (the marker's), `number` = of the first number.
 */
export function numberTail(toks: readonly Tok[]): { at: number; number: number } | undefined {
    let i = toks.length;
    while (i > 0 && isNumberTok(toks[i - 1])) i--;
    if (i === toks.length) return undefined;
    for (let s = Math.max(0, i - 3); s < i; s++) {
        const m = markerAt(toks, s);
        if (m && s + m === i) return { at: s, number: i };
    }
    return { at: i, number: i };
}

/** A word of a street: one of the words, one ending so, or a last word ("Main St."). */
export function streetWord(toks: readonly Tok[]): boolean {
    const t = streetTerms();
    return toks.some(
        (x, i) =>
            t.words.has(x.fold) ||
            // a word ending so, with three letters before at least ("Hauptstr.", never "Ostr.")
            t.suffixes.some(s => x.fold.length >= s.length + 3 && x.fold.endsWith(s)) ||
            (i === toks.length - 1 && toks.length > 1 && t.last.has(x.fold)),
    );
}

/** A street's name folded, without the house number after it ("Dlouhá 12" → "dlouha"); "" when no letter is left. */
export function nameOf(toks: readonly Tok[]): string {
    const tail = numberTail(toks);
    const words = toks.slice(0, tail ? tail.at : toks.length);
    return words.some(w => LETTER.test(w.fold)) && !markerAt(words, 0) ? words.map(w => w.fold).join(' ') : '';
}

/** The street a house names ("Dlouhá 88" → "dlouha"; "13" → ""). */
export function streetOfHouse(house: string): string {
    return nameOf(tokens(house.normalize('NFC')));
}

/**
 * The house of a fact whose place held `street`: the street (and its number)
 * where the fact has no house, the street before a house of numbers alone
 * ("nám. Míru" and "5" are "nám. Míru 5"), the house as it is where it says the
 * same (or names the street with its number: "Dlouhá 88" beside "Dlouhá");
 * undefined where it says another thing.
 */
export function houseWith(street: string, had: string | undefined): string | undefined {
    const h = had?.trim();
    if (!h || foldText(h) === foldText(street)) return h || street;
    const numbered = /\p{N}/u.test(street);
    if (!numbered && numbersOnly(h)) return `${street} ${h}`;
    if (!numbered && streetOfHouse(street) && streetOfHouse(h) === streetOfHouse(street)) return h;
    return undefined;
}

/** A place split into the municipality and the house. */
export interface StreetSplit {
    /** The place without them ("Lhota", "Lhota, okres Horní"). */
    town: string;
    /** The street and the number as written ("Dlouhá 12", "nám. Míru", "12"). */
    house: string;
    /**
     * How it is told: a street's word or a house number's marker (`word`), a
     * street of the tree's houses (`known`), or a number alone after a
     * municipality whose numbers a person said are houses (`town`).
     */
    by: 'word' | 'known' | 'town';
}

/** The streets of the tree's houses at a municipality (its first part folded), see knownStreets in places.ts. */
export type KnownStreets = (town: string) => ReadonlySet<string> | undefined;

/**
 * What a place holds of a street or a house number, or undefined where nothing
 * of it is clear: a part with a street's word ("Lhota, nám. Míru"), a house
 * number with its marker or a part of numbers alone ("Lhota, č. p. 12",
 * "Lhota, 12"), a street the tree's houses at the same municipality name
 * (`known`: "Lhota, Dlouhá" where a house is "Dlouhá 88"), a part after the
 * municipality of words and a house number ("Lhota, Dlouhá 12"). A second part
 * that is none of these (a part of the village, a parish, a district, the
 * municipality's own name with a number: "Praha, Praha 5") stays. A number
 * alone after the name ("Lhota 16") is never taken (see bareNumber).
 */
export function splitStreet(place: string, known?: KnownStreets): StreetSplit | undefined {
    const text = place.normalize('NFC');
    const parts = text.split(',').map(p => p.trim());
    if (!parts[0]) return undefined;
    const streets = known?.(foldText(parts[0]));
    const keep: string[] = [];
    const house: string[] = [];
    let by: StreetSplit['by'] = 'word';
    for (const [i, part] of parts.entries()) {
        const toks = tokens(part);
        if (!toks.length) continue;
        const tail = numberTail(toks);
        // the first part is the municipality: a street before it only with its
        // number ("Hauptstraße 3, Lhotau"), and only where another part is left
        const free = i > 0 || parts.length > 1;
        if (free && tail && tail.at === 0) {
            // numbers alone, or with their marker: the house number ("12", "č. p. 12")
            house.push(part.slice(toks[tail.number]!.start).trim());
            continue;
        }
        if (free && (i > 0 || tail) && streetWord(toks)) {
            house.push(part);
            continue;
        }
        if (i > 0 && streets?.has(nameOf(toks))) {
            house.push(part);
            by = 'known';
            continue;
        }
        // a part after the municipality of words and a house number at its end
        // ("Lhota, Dlouhá 12", "Lhota, Polní 5/3"): a street with its number —
        // never the municipality's own name with a number ("Praha, Praha 5")
        if (i > 0 && tail && tail.at === tail.number && tail.at > 0 && nameOf(toks) && nameOf(toks) !== nameOf(tokens(parts[0]!))) {
            house.push(part);
            continue;
        }
        // a house number with its marker at the end of a part ("Lhota č. p. 12",
        // "Lhota, Horní Lhota Nr. 3"): the number
        if (tail && tail.at < tail.number && tail.at > 0) {
            keep.push(part.slice(0, toks[tail.at]!.start).replace(/[\s,;:–-]+$/u, '').trim());
            house.push(part.slice(toks[tail.number]!.start).trim());
            continue;
        }
        keep.push(part);
    }
    if (!house.length || !keep.length || !keep[0]) return undefined;
    return { town: keep.join(', '), house: house.join(' '), by };
}

/** A number alone after the municipality's name. */
export interface BareNumber {
    /** The name before the number ("Lhota" of "Lhota 16, okres Horní"). */
    name: string;
    /** The place without the number ("Lhota, okres Horní"). */
    town: string;
    /** The number as written ("16", "16a", "13/2"). */
    house: string;
}

/**
 * A number alone at the end of the place's first part, after words, with no
 * marker ("Lhota 16", "Lhota 16, okres Horní", "Horní Lhota 3a"): a house or a
 * part of the municipality ("Praha 5") — splitStreet never takes it; undefined
 * for anything else ("Lhota", "Lhota č. p. 16", "16 Lhota").
 */
export function bareNumber(place: string): BareNumber | undefined {
    const parts = place.normalize('NFC').split(',').map(p => p.trim());
    const first = parts[0];
    if (!first) return undefined;
    const toks = tokens(first);
    const tail = numberTail(toks);
    if (!tail || tail.at !== tail.number || tail.at === 0) return undefined;
    if (!toks.slice(0, tail.at).some(w => LETTER.test(w.fold))) return undefined;
    const name = first.slice(0, toks[tail.at]!.start).replace(/[\s,;:–-]+$/u, '').trim();
    if (!name) return undefined;
    return { name, town: [name, ...parts.slice(1).filter(Boolean)].join(', '), house: first.slice(toks[tail.at]!.start).trim() };
}

/** Whether a municipality's numbers are part of it by the terms ("Praha", "Wien"): never a house. */
export function numberedTown(name: string): boolean {
    return streetTerms().numbered.has(foldText(name));
}
