/**
 * Where an entry stands in its book, field by field (spec 075): the archive
 * (`Source.repository`), the call number of the book (`callNumber`), the folio
 * or page as the book numbers it (`folio`), the image number as the archive's
 * portal counts it (`image`) and the rest of the location (`reference`: an
 * entry's number, a column). An older source has none of the three new fields:
 * its `reference` is then the whole location, as it always was.
 *
 * The rules of recognising a folio and an image in an older location, and of
 * composing one readable GEDCOM PAGE from the fields, are Strom Research's
 * (its src/core/sourcefields.ts and sourcesplit.ts, 1.31): the same code in
 * both programs, checked against the research's shared cases
 * (test/fixtures/source-locations.json, a copy). Nothing here changes a
 * source by itself: a recognised folio or image is a proposal only.
 */

import type { Source } from './types.js';
import { foldText } from './streets.js';
import { getCurrentLanguage, getStringsForLang, type Language } from './strings.js';

/** The fields of a source that say where its entry stands. */
export type SourcePlace = Pick<Source, 'repository' | 'callNumber' | 'folio' | 'image' | 'reference'>;

/** A source's folio, image and the rest of its location (what a split changes). */
export interface SourceEntryPlace {
    folio?: string;
    image?: string;
    reference?: string;
}

/** What of a location the fields say too: the folio and image it names (the same number or not) and its rest. */
export interface LocationOverlap {
    folio?: { named: string; same: boolean };
    image?: { named: string; same: boolean };
    /** The location without the parts named ('' when nothing is left). */
    rest: string;
}

/** A folio and an image recognised in a location, as a proposal (never written by itself). */
export interface LocationProposal {
    /** The folio with its word as it stands ("fol. 12v", "pag. 112", "S. 15"). */
    folio?: string;
    /** The image's number or range ("34", "57–58"). */
    image?: string;
    /** The location without what was recognised ('' when nothing is left). */
    rest: string;
    /** With a source given: what of its location its folio and image fields say too (absent: nothing). */
    overlap?: LocationOverlap;
}

const has = (v: string | undefined): boolean => !!v?.trim();

/**
 * Whether the source has any of the new fields (call number, folio, image):
 * then its `reference` is the rest of the location, else the whole of it.
 */
export function hasPlaceFields(s: SourcePlace | null | undefined): boolean {
    return !!s && (has(s.callNumber) || has(s.folio) || has(s.image));
}

/** Whether the source has a folio or an image: its GEDCOM PAGE is then composed and its fields go as `_STROM_*`. */
export function hasEntryFields(s: Pick<Source, 'folio' | 'image'> | null | undefined): boolean {
    return !!s && (has(s.folio) || has(s.image));
}

// ---- Recognition (the research's sourcefields.ts) ----

// Not a letter, mark or digit before a word: where a word starts in any script (never \b, which knows ASCII only).
const START = '(?<![\\p{L}\\p{M}\\p{N}])';
// A number, a folio's side (r, v, recto, verso) right after it or after one space, and a range of them.
const SIDE = '(?:\\s?(?:recto|verso|[rv])(?![\\p{L}\\p{M}\\p{N}]))?';
// A number never goes on with a letter: "Pag. 1ma" (the first) is no page 1, "fol. 12a" no folio 12.
const FOLIO_NUMBER = `\\d+${SIDE}(?:\\s*[-–—]\\s*\\d+${SIDE})?(?![\\p{L}\\p{M}\\p{N}])`;
const IMAGE_NUMBER = '\\d+(?:\\s*[-–—]\\s*\\d+)?(?![\\p{L}\\p{M}\\p{N}])';
// The words of a folio or page (longest first: "strona" before "str." before "s."), each as the book writes it.
const FOLIO_WORDS = ['folium', 'folio', 'fol\\.?', 'f\\.', 'pag\\.?', 'p\\.', 'seite', 'strona', 'str\\.', 's\\.'];
// The words of an image, then optionally its number's word (č., nr, no.).
const IMAGE_WORDS = ['snímek', 'snimek', 'sn\\.', 'image', 'img\\.?', 'scan', 'skan', 'bild', 'obraz', 'obr\\.', 'kadr'];
const FOLIO = new RegExp(`${START}(?:${FOLIO_WORDS.join('|')})(?![\\p{L}\\p{M}])\\s*(${FOLIO_NUMBER})`, 'iu');
const IMAGE = new RegExp(`${START}(?:${IMAGE_WORDS.join('|')})(?![\\p{L}\\p{M}])\\s*(?:(?:č\\.|c\\.|nr\\.?|no\\.)\\s*)?(${IMAGE_NUMBER})`, 'iu');
const BARE_FOLIO = new RegExp(`^\\s*(${FOLIO_NUMBER})\\s*$`, 'iu');

/** A part of a location: as it stands, its number, where it is in the text. */
interface Part { text: string; number: string; at: number }

function part(re: RegExp, text: string): Part | undefined {
    const m = re.exec(text);
    return m ? { text: m[0], number: m[1]!, at: m.index } : undefined;
}

/** The one part a text names, or none when it names two ("S. 12 of the edition (PDF S. 14), fol. 3r": which is it?). */
function onlyPart(re: RegExp, text: string): Part | undefined {
    const first = part(re, text);
    if (!first) return undefined;
    return part(re, text.slice(first.at + first.text.length)) ? undefined : first;
}

/** The folio and image a location names (each only when it names one of them), as they stand. */
function recognized(text: string | undefined): { folio?: string; image?: string } {
    if (!text?.trim()) return {};
    const t = text.normalize('NFC');
    const folio = onlyPart(FOLIO, t)?.text.replace(/\s+/gu, ' ').trim();
    const image = onlyPart(IMAGE, t)?.number.replace(/\s+/gu, '');
    return { ...(folio ? { folio } : {}), ...(image ? { image } : {}) };
}

/** A number of a folio or image as compared: no spaces, one dash, folded ("12 v" is "12v", "57–58" is "57-58"). */
function sameNumber(a: string, b: string): boolean {
    const n = (x: string): string => foldText(x).replace(/\s+/gu, '').replace(/[–—]/gu, '-');
    return n(a) === n(b);
}

/** The folio's number of a folio given: after its word, or the folio alone a number. */
function folioNumber(folio: string): string | undefined {
    const t = folio.normalize('NFC');
    return part(FOLIO, t)?.number ?? BARE_FOLIO.exec(t)?.[1];
}

/**
 * The text with its part cut out, the separators around it tidied ("č. 5, snímek 3, ř. 2" → "č. 5, ř. 2";
 * "sn. 19 = fol. 7" → "sn. 19"; "018 = fol. 5 — read in ink" → "018, read in ink"); a part in brackets with them.
 */
function cut(text: string, p: Part): string {
    const before = text.slice(0, p.at).replace(/(?:[\s,;:·=]|\s[-–—])+$/u, '');
    const sep = text.slice(before.length, p.at);
    let after = text.slice(p.at + p.text.length).replace(/^(?:[\s,;:·=]|[-–—]\s)+/u, '');
    let head = before;
    if (/[([]$/u.test(head) && /^[)\]]/u.test(after)) {
        head = head.slice(0, -1).replace(/[\s,;:·]+$/u, '');
        after = after.slice(1).replace(/^[\s,;:·]+/u, '');
    }
    if (!head || !after) return head || after;
    const punct = /[,;:·]/u.exec(sep)?.[0] ?? ',';
    return `${head}${punct} ${after}`;
}

/** Whether a text says a part word by word (folded, a whole word: "fol. 1" is not in "fol. 12"). */
function says(text: string, what: string): boolean {
    const t = foldText(text);
    const w = foldText(what);
    if (!w) return false;
    const escaped = w.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
    return new RegExp(`${START}${escaped}(?![\\p{L}\\p{M}\\p{N}])`, 'u').test(t);
}

/**
 * What of a source's location its folio and image fields say too (spec 075 N1):
 * the folio and the image the location names where a field gives one — the
 * same number (perhaps another word) or another — and the location without
 * them. Undefined when the location names neither or no such field is given.
 */
export function locatorOverlap(s: Pick<Source, 'folio' | 'image' | 'reference'>): LocationOverlap | undefined {
    const folio = s.folio?.trim();
    const image = s.image?.trim();
    let rest = s.reference?.trim().normalize('NFC');
    if (!rest || (!folio && !image)) return undefined;
    const out: { folio?: LocationOverlap['folio']; image?: LocationOverlap['image'] } = {};
    const f = folio ? part(FOLIO, rest) : undefined;
    if (f) {
        const n = folioNumber(folio!);
        out.folio = { named: f.text.replace(/\s+/gu, ' ').trim(), same: n !== undefined && sameNumber(n, f.number) };
        rest = cut(rest, f);
    }
    const i = image ? part(IMAGE, rest) : undefined;
    if (i) {
        out.image = { named: i.number.replace(/\s+/gu, ''), same: sameNumber(image!, i.number) };
        rest = cut(rest, i);
    }
    return out.folio || out.image ? { ...out, rest } : undefined;
}

/**
 * The folio and the image an older location names, and its rest without them:
 * a proposal only (the source editor's "Take", the split's preview). Null when
 * it names neither (a location naming two folios proposes no folio, two
 * images no image). Recognition is the same in every language (`lang` is not
 * needed for it). Given a source instead of its location, `overlap` says what
 * of the location its folio and image fields say too (the editor's conflict).
 */
export function recognizeLocation(
    location: string | Pick<Source, 'folio' | 'image' | 'reference'> | null | undefined,
    lang?: Language,
): LocationProposal | null {
    void lang;
    const given = typeof location === 'object' && location ? location : undefined;
    const text = given ? given.reference : (location as string | null | undefined) ?? undefined;
    const found = recognized(text);
    const overlap = given ? locatorOverlap(given) : undefined;
    if (!found.folio && !found.image) return overlap ? { rest: overlap.rest, overlap } : null;
    const rest = locatorOverlap({ reference: text, ...found })?.rest ?? text!.trim().normalize('NFC');
    return { ...found, rest, ...(overlap ? { overlap } : {}) };
}

// ---- Composing the PAGE ----

/** The word of an image in a language ("snímek", "image", "Bild", "skan"): the PAGE's and the long place line's. */
export function imageWord(lang: Language = getCurrentLanguage()): string {
    return getStringsForLang(lang).sources.imageWord;
}

/**
 * The readable location of the source (GEDCOM PAGE) from the fields given:
 * the folio, the rest of the location, the image ("snímek 34" in the app's
 * language), joined ", ". With neither folio nor image it is the reference
 * exactly (an older source's PAGE as it always was).
 *
 * A part the reference names too is said once (N1): the same number, perhaps
 * another word ("scan 101" beside image 101), stays as the reference says it;
 * another number gives way to the field (given later, on purpose). The
 * reference itself is never changed (`_STROM_LOCATOR` carries it whole).
 */
export function composePage(s: Pick<Source, 'folio' | 'image' | 'reference'>, lang: Language = getCurrentLanguage()): string | undefined {
    const folio = s.folio?.trim();
    const image = s.image?.trim();
    if (!folio && !image) return s.reference;
    let locator = s.reference?.trim();
    let folioSaid = false;
    let imageSaid = false;
    const imagePart = image ? `${imageWord(lang)} ${image}` : undefined;
    if (locator) {
        const t = locator.normalize('NFC');
        const f = folio ? part(FOLIO, t) : undefined;
        let rest = t;
        if (f) {
            const n = folioNumber(folio!);
            if (n !== undefined && sameNumber(n, f.number)) folioSaid = true;
            else rest = cut(rest, f);
        } else if (folio && /\p{L}/u.test(folio) && says(t, folio)) folioSaid = true;
        const i = image ? part(IMAGE, rest) : undefined;
        if (i) {
            if (sameNumber(image!, i.number)) imageSaid = true;
            else rest = cut(rest, i);
        } else if (imagePart && says(rest, imagePart)) imageSaid = true;
        // the location as it stands when nothing of it gave way
        locator = rest === t ? locator : rest;
    }
    const parts = [folio && !folioSaid ? folio : undefined, locator || undefined, imagePart && !imageSaid ? imagePart : undefined]
        .filter((x): x is string => !!x);
    return parts.length ? parts.join(', ') : undefined;
}

// ---- Splitting an older location ----

/**
 * What one source's split would be (spec 075 §5, the research's splitOf), or
 * undefined when it changes nothing: the folio its location names while the
 * source has no folio, the image while it has none, and the location without
 * them — and without a part a field says the same already (once is enough);
 * a part a field says otherwise stays in the location (the person's). A
 * location with nothing left is gone (`reference` absent).
 */
export function splitSource(s: Pick<Source, 'folio' | 'image' | 'reference'>): SourceEntryPlace | undefined {
    if (!s.reference?.trim()) return undefined;
    const found = recognized(s.reference);
    const folio = !has(s.folio) && found.folio ? found.folio : undefined;
    const image = !has(s.image) && found.image ? found.image : undefined;
    const given = locatorOverlap(s);
    const cutFolio = folio ?? (given?.folio?.same ? s.folio : undefined);
    const cutImage = image ?? (given?.image?.same ? s.image : undefined);
    if (!folio && !image && !cutFolio && !cutImage) return undefined;
    const rest = locatorOverlap({ reference: s.reference, folio: cutFolio, image: cutImage })?.rest;
    const place = (p: SourceEntryPlace): SourceEntryPlace => ({
        ...(has(p.reference) ? { reference: p.reference } : {}),
        ...(has(p.folio) ? { folio: p.folio } : {}),
        ...(has(p.image) ? { image: p.image } : {}),
    });
    const after = place({ reference: rest, folio: folio ?? s.folio, image: image ?? s.image });
    const before = place(s);
    return JSON.stringify(after) === JSON.stringify(before) ? undefined : after;
}

/** A source with its split applied (`splitSource`): the other fields as they are, `reference` absent when nothing is left. */
export function withSplit<T extends Pick<Source, 'folio' | 'image' | 'reference'>>(s: T, after: SourceEntryPlace): T {
    const out = { ...s };
    for (const k of ['folio', 'image', 'reference'] as const) {
        if (has(after[k])) out[k] = after[k];
        else delete out[k];
    }
    return out;
}

// ---- Showing the place ----

/**
 * The parts of a source's place: the book (archive, call number) and the
 * entry (folio, "snímek N", the rest of the location), each without the
 * empty ones. An older source (none of call number, folio, image) has its
 * whole location in `whole` and an empty `entry`.
 */
export function sourcePlaceParts(s: SourcePlace, lang: Language = getCurrentLanguage()): { book: string[]; entry: string[]; whole?: string } {
    const t = (v: string | undefined): string => v?.trim() ?? '';
    const book = [t(s.repository), t(s.callNumber)].filter(Boolean);
    if (!hasPlaceFields(s)) {
        const whole = t(s.reference);
        return { book, entry: [], ...(whole ? { whole } : {}) };
    }
    const entry = [t(s.folio), t(s.image) ? `${imageWord(lang)} ${t(s.image)}` : '', t(s.reference)].filter(Boolean);
    return { book, entry };
}

/** The entry's place without the book: the folio, "snímek N" and the rest, or an older source's whole location. */
export function sourceEntryText(s: SourcePlace, sep = ' · ', lang: Language = getCurrentLanguage()): string {
    const p = sourcePlaceParts(s, lang);
    return p.whole ?? p.entry.join(sep);
}

/**
 * A source's place on one line, joined " · ", the empty parts left out:
 * - `long`: archive · call number · folio · "snímek N" · the rest (older: archive · location);
 * - `short`: archive · call number · folio · "sn. N" — the rest left out (older: archive · location);
 * - `list-phone`: as short, without the archive when there is a call number.
 */
export function sourcePlaceLine(s: SourcePlace, form: 'short' | 'long' | 'list-phone', lang: Language = getCurrentLanguage()): string {
    const t = (v: string | undefined): string => v?.trim() ?? '';
    if (!hasPlaceFields(s)) return [t(s.repository), t(s.reference)].filter(Boolean).join(' · ');
    const image = t(s.image);
    const word = form === 'long' ? imageWord(lang) : getStringsForLang(lang).sources.imageShort;
    const archive = form === 'list-phone' && t(s.callNumber) ? '' : t(s.repository);
    return [archive, t(s.callNumber), t(s.folio), image ? `${word} ${image}` : '', form === 'long' ? t(s.reference) : '']
        .filter(Boolean).join(' · ');
}

/** The source's place as one text to search in (archive, call number, folio, image, location). */
export function sourcePlaceSearchText(s: SourcePlace): string {
    return [s.repository, s.callNumber, s.folio, s.image, s.reference].map(v => v?.trim() ?? '').filter(Boolean).join(' · ');
}

/**
 * A key of where the entry stands, the same whether its folio and image are
 * fields or still words of its location: the composed PAGE (an older
 * research given the PAGE gives it back as the whole location). Without the
 * call number, which is the book's and lived in the note before.
 */
export function sourcePlaceKey(s: Pick<Source, 'folio' | 'image' | 'reference'>, lang: Language = getCurrentLanguage()): string {
    return (composePage(s, lang) ?? '').trim();
}

/** Whether two sources' places differ (any of call number, folio, image, location; trimmed). */
export function sourcePlaceDiffers(a: SourcePlace, b: SourcePlace): boolean {
    return (['callNumber', 'folio', 'image', 'reference'] as const).some(k => (a[k] ?? '').trim() !== (b[k] ?? '').trim());
}
