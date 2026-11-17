/**
 * The books of the research's tasks (spec 105): the pure half — finding a
 * book, its title, its texts (images, the offer, the head's second line and
 * title) and the orders of "Most tasks" and "Faster by downloading". The app
 * never counts anything of a book itself: every number comes from the
 * research's `/status.books`; these only say and sort what it said.
 */

import { strings } from './strings.js';
import type { LiveBook, LiveBooks } from './research-link.js';
import { foldSearch2, matchDoc, type SearchToken } from './section-search-match.js';

/** The texts of the books (`strings.live.books` of a language). */
export type BooksTexts = typeof strings.live.books;

/** Hyphens between digits as dashes ("1784-1820" → "1784–1820"). */
export function dashRanges(text: string): string {
    return text.replace(/(\d)\s*-\s*(\d)/g, '$1–$2');
}

/** A book of the research's list by its id, or null (the list not said, or the book outside it). */
export function bookById(s: { books?: LiveBooks } | null | undefined, id: string | null | undefined): LiveBook | null {
    if (!id || !s?.books) return null;
    return s.books.list.find(b => b.id === id) ?? null;
}

/** The book's title, with its years when the title does not carry them already (V10). */
export function bookTitle(b: Pick<LiveBook, 'title' | 'years'>): string {
    const title = b.title.trim();
    const years = b.years ? dashRanges(b.years.trim()) : '';
    if (!years || dashRanges(title).includes(years)) return title;
    return `${title} ${years}`;
}

/** "516 images · on disk 303 · missing 213"; without known images only "on disk N" (missing only beside images). */
export function bookImagesText(b: Pick<LiveBook, 'images' | 'onDisk' | 'missing'>, L: BooksTexts = strings.live.books): string {
    return bookImagesPieces(b, L).join(' · ');
}

function bookImagesPieces(b: Pick<LiveBook, 'images' | 'onDisk' | 'missing'>, L: BooksTexts): string[] {
    const parts: string[] = [];
    if (b.images !== undefined) parts.push(L.images(b.images));
    parts.push(L.onDisk(b.onDisk));
    if (b.images !== undefined && b.missing !== undefined) parts.push(L.missing(b.missing));
    return parts;
}

/**
 * What can be downloaded of the book: the whole book (only with `download: whole`), a range or the selected
 * images the tasks need. '' without the offer, for `none`, and for a range or a selection without `need`;
 * the count of images only as the research said it.
 */
export function bookOfferText(b: Pick<LiveBook, 'offer' | 'download' | 'images' | 'need' | 'needCount'>, L: BooksTexts = strings.live.books): string {
    if (!b.offer || b.download === 'none') return '';
    if (b.download === 'whole') return L.offerWhole(b.images);
    if (!b.need) return '';
    const list = dashRanges(b.need);
    return b.download === 'range' ? L.offerRange(list, b.needCount) : L.offerSelected(list, b.needCount);
}

/** The number in a book's id ("B0003" → 3), for its order. */
function bookNumber(id: string): number {
    const n = Number(/\d+/.exec(id)?.[0] ?? NaN);
    return Number.isFinite(n) ? n : Number.MAX_SAFE_INTEGER;
}

/** The fields "Most tasks" orders a book by. */
export type BookOrderFields = Pick<LiveBook, 'id' | 'tasks' | 'waiting' | 'images' | 'missing'>;

/**
 * A book whole on disk (nothing missing, its images known); every other book
 * is one to download, a book whose images are not known too (spec 105 U4 §4).
 */
export function bookWholeOnDisk(b: Pick<LiveBook, 'images' | 'missing'>): boolean {
    return b.images != null && b.missing === 0;
}

/**
 * "Most tasks" (spec 105 U4 §4): the books to download first (images missing
 * or not known), then those whole on disk; within each tasks ↓, then waiting
 * ↓, then the id's number ↑.
 */
export function sortBooksMost(a: BookOrderFields, b: BookOrderFields): number {
    return Number(bookWholeOnDisk(a)) - Number(bookWholeOnDisk(b))
        || b.tasks - a.tasks || b.waiting - a.waiting || bookNumber(a.id) - bookNumber(b.id) || a.id.localeCompare(b.id);
}

/** "Faster by downloading": the books offered that nothing waits for, in the order of "Most tasks". */
export function urgentBooks(books: LiveBooks | null | undefined): LiveBook[] {
    if (!books) return [];
    return books.list.filter(b => b.offer && b.waiting === 0).sort(sortBooksMost);
}

/** One piece of a book head's line of facts. */
export interface BookMetaPart {
    /** counts (tasks · waiting · in the queue · parked) | images | pending | login. */
    kind: 'counts' | 'images' | 'pending' | 'login';
    text: string;
    /** Its pieces (`text` is them joined by " · "). */
    pieces: string[];
    /** The piece that is the key of "Most tasks" (bold there; -1: none): the tasks, the images missing. */
    key: number;
}

/**
 * The images of a book's head: "516 images · on disk 303 · missing 213"; a
 * book whole on disk (nothing missing) "516 images · whole book on disk".
 */
export function bookHeadImagesText(b: Pick<LiveBook, 'images' | 'onDisk' | 'missing'>, L: BooksTexts = strings.live.books): string {
    return bookHeadImagesPieces(b, L).join(' · ');
}

function bookHeadImagesPieces(b: Pick<LiveBook, 'images' | 'onDisk' | 'missing'>, L: BooksTexts): string[] {
    if (b.missing !== 0) return bookImagesPieces(b, L);
    return [...(b.images !== undefined ? [L.images(b.images)] : []), L.wholeOnDisk];
}

/**
 * The line of facts of a book's head (spec 105 U4 §1): tasks · waiting [· in
 * the queue] [· parked] · images [· to be taken in] [· sign-in]. The archive
 * stands whole on its own line above it.
 */
export function bookMetaParts(b: LiveBook, L: BooksTexts = strings.live.books): BookMetaPart[] {
    const part = (kind: BookMetaPart['kind'], pieces: string[], key = -1): BookMetaPart => ({ kind, text: pieces.join(' · '), pieces, key });
    const counts = [L.tasks(b.tasks), L.waiting(b.waiting), ...(b.open > 0 ? [L.inQueue(b.open)] : []), ...(b.parked > 0 ? [L.parked(b.parked)] : [])];
    // The images: "missing N" the key beside them; a book whole on disk has only its tasks bold.
    const images = bookHeadImagesPieces(b, L);
    const missing = b.images !== undefined && b.missing !== undefined && b.missing > 0 ? images.length - 1 : -1;
    const out: BookMetaPart[] = [part('counts', counts, 0), part('images', images, missing)];
    if (b.pending) out.push(part('pending', [L.pending(b.pending)]));
    if (b.access === 'online-login') out.push(part('login', [L.login]));
    return out;
}

/** The head's `title`: the title, the archive, the tasks and how many of them are parked (Q3). */
export function bookHeadTitle(b: LiveBook, L: BooksTexts = strings.live.books): string {
    return L.headTitle(bookTitle(b), b.archive?.name ?? '', b.tasks, b.parked);
}

/** The archive's website of the book: its viewer, else the archive's own address (null: none said). */
export function bookWebUrl(b: Pick<LiveBook, 'url' | 'archive'>): string | null {
    return b.url ?? b.archive?.url ?? null;
}

/**
 * "Faster by downloading" as the section shows it (§3): under the filter All
 * or Images only (none under another kind); searching, only the books whose
 * title or archive match the words (none: nothing).
 */
export function urgentBooksShown(books: LiveBooks | null | undefined, filter: string, toks: readonly SearchToken[] = []): LiveBook[] {
    if (filter !== 'all' && filter !== 'images') return [];
    const list = urgentBooks(books);
    if (toks.length === 0) return list;
    return list.filter(b => matchDoc({ hay: foldSearch2([bookTitle(b), b.archive?.name ?? ''].join(' ')) }, toks) !== null);
}
