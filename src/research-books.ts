/**
 * The books of the research's tasks (spec 105): the pure half — finding a
 * book, its title, its texts (images, the offer, the head's second line and
 * title) and the orders of "Most tasks" and "Faster by downloading". The app
 * never counts anything of a book itself: every number comes from the
 * research's `/status.books`; these only say and sort what it said.
 */

import { strings } from './strings.js';
import type { LiveBook, LiveBooks } from './research-link.js';

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
    const parts: string[] = [];
    if (b.images !== undefined) parts.push(L.images(b.images));
    parts.push(L.onDisk(b.onDisk));
    if (b.images !== undefined && b.missing !== undefined) parts.push(L.missing(b.missing));
    return parts.join(' · ');
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

/** "Most tasks": tasks ↓, then waiting ↓, then the id's number ↑. */
export function sortBooksMost(a: Pick<LiveBook, 'id' | 'tasks' | 'waiting'>, b: Pick<LiveBook, 'id' | 'tasks' | 'waiting'>): number {
    return b.tasks - a.tasks || b.waiting - a.waiting || bookNumber(a.id) - bookNumber(b.id) || a.id.localeCompare(b.id);
}

/** "Faster by downloading": the books offered that nothing waits for, in the order of "Most tasks". */
export function urgentBooks(books: LiveBooks | null | undefined): LiveBook[] {
    if (!books) return [];
    return books.list.filter(b => b.offer && b.waiting === 0).sort(sortBooksMost);
}

/** One piece of a book head's second line. */
export interface BookMetaPart {
    /** archive | counts (waiting · in the queue; the key of "Most tasks") | images | pending | login. */
    kind: 'archive' | 'counts' | 'images' | 'pending' | 'login';
    text: string;
}

/**
 * The second line of a book's head (§1): archive · waiting [· in the queue] · images [· to be taken in]
 * [· sign-in]. In "Most tasks" (`most`) the counts come first (the order's key, drawn bold). Without an
 * archive said, none.
 */
export function bookMetaParts(b: LiveBook, opts: { most?: boolean } = {}, L: BooksTexts = strings.live.books): BookMetaPart[] {
    const counts: BookMetaPart = { kind: 'counts', text: [L.waiting(b.waiting), ...(b.open > 0 ? [L.inQueue(b.open)] : [])].join(' · ') };
    const out: BookMetaPart[] = [];
    if (opts.most) out.push(counts);
    if (b.archive?.name) out.push({ kind: 'archive', text: b.archive.name });
    if (!opts.most) out.push(counts);
    out.push({ kind: 'images', text: bookImagesText(b, L) });
    if (b.pending) out.push({ kind: 'pending', text: L.pending(b.pending) });
    if (b.access === 'online-login') out.push({ kind: 'login', text: L.login });
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
