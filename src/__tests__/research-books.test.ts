/**
 * The books of the research's tasks (spec 105): `/status.books` read as the
 * research says it (and nothing without the feature), the light status's
 * part `books`, `book` on waiting and queued tasks, the `book` link, and the
 * pure texts and orders of research-books.ts. Invented books and archives.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
    BOOKS_FEATURE, booksOn, sanitizeBooks, sanitizeBook, sanitizeBooksSettings, sanitizeLiveStatus, sanitizeQueue, sanitizeWaiting,
    researchSchemeUrl, researchLinkMark, researchUrlMark, type LiveBook, type LiveBooks,
} from '../research-link.js';
import {
    bookById, bookTitle, bookImagesText, bookOfferText, urgentBooks, sortBooksMost, bookMetaParts, bookHeadTitle, bookWebUrl, dashRanges,
} from '../research-books.js';
import { STATUS_PARTS_FEATURE, completeStatus, forgetStatusParts } from '../status-parts.js';
import { setLanguage, getStringsForLang, strings } from '../strings.js';
import { postBridgeBooks, booksSettingReply } from '../history-bridge.js';
import { booksSettingHtml, booksMinTasksInput } from '../ui/books-setting-view.js';

const TREE = '0b4c7a52-1c1f-4d7e-9a53-2f4a3c1e8b10';

/** The research's own example (ZADANI_VYZKUM „Odpověď výzkumu (U3b)“), with invented names. */
function rawBooks(): Record<string, unknown> {
    return {
        settings: { minTasks: 5, minTasksOwn: false, minTasksDefault: 5, sameBook: 'no', sameBookOwn: false, sameBookDefault: 'no' },
        list: [
            {
                id: 'B0002', title: 'Матрика Lhotíčky O 1800–1850', folder: 'B0002 Матрика Lhotíčky O 1800–1850',
                access: 'online-free', url: 'https://archive.example/matrika/detail/101',
                tasks: 5, waiting: 1, open: 4, parked: 0, images: 10, onDisk: 0, missing: 10,
                need: '3', needCount: 1, download: 'range', offer: true,
            },
            {
                id: 'B0001', title: 'Lhota 3, N 1784–1820', folder: 'B0001 Lhota 3, N 1784–1820',
                archive: { id: 'R0001', name: 'Archiv v Lhotě', url: 'https://archiv-lhota.example/' },
                years: '1784-1820', access: 'online-free', url: 'https://archiv-lhota.example/kniha/3',
                tasks: 5, waiting: 0, open: 5, parked: 0, images: 20, onDisk: 0, missing: 20,
                download: 'whole', downloadTerms: { how: 'allowed', says: 'Celou knihu lze stáhnout.', from: 'reply', host: 'archiv-lhota.example' },
                offer: true, pending: 1,
            },
        ],
        more: 0,
    };
}

function book(over: Partial<LiveBook> = {}): LiveBook {
    return { id: 'B0003', title: 'Lhota 3, N', tasks: 16, waiting: 2, open: 13, parked: 1, onDisk: 303, download: 'range', ...over };
}

describe('/status.books', () => {
    it('is read as the research says it, with or without the archive', () => {
        const b = sanitizeBooks(rawBooks())!;
        expect(b.settings).toEqual({ minTasks: 5, minTasksOwn: false, minTasksDefault: 5, sameBook: 'no', sameBookOwn: false, sameBookDefault: 'no' });
        expect(b.more).toBe(0);
        expect(b.list.map(x => x.id)).toEqual(['B0002', 'B0001']);
        // No archive said: none (the book still works).
        expect(b.list[0].archive).toBeUndefined();
        expect(b.list[0]).toMatchObject({ need: '3', needCount: 1, download: 'range', offer: true, images: 10, missing: 10 });
        expect(b.list[1]).toMatchObject({
            archive: { id: 'R0001', name: 'Archiv v Lhotě', url: 'https://archiv-lhota.example/' },
            years: '1784-1820', download: 'whole', offer: true, pending: 1, folder: 'B0001 Lhota 3, N 1784–1820',
        });
        // The terms are not shown yet: not kept.
        expect(b.list[1]).not.toHaveProperty('downloadTerms');
    });

    it('drops what is wrong and keeps what it does not know absent', () => {
        expect(sanitizeBooks(null)).toBeNull();
        expect(sanitizeBooks({ list: [] })).toBeNull();
        expect(sanitizeBooksSettings({ minTasks: 0, sameBook: 'no' })).toBeNull();
        expect(sanitizeBooksSettings({ minTasks: 1000, sameBook: 'no' })).toBeNull();
        expect(sanitizeBooksSettings({ minTasks: '5', sameBook: 'no' })).toBeNull();
        expect(sanitizeBooksSettings({ minTasks: 6, sameBook: 'maybe' })).toBeNull();
        expect(sanitizeBooksSettings({ minTasks: 6, minTasksOwn: true, sameBook: 'yes', sameBookOwn: true }))
            .toEqual({ minTasks: 6, minTasksOwn: true, sameBook: 'yes', sameBookOwn: true });
        expect(sanitizeBook({ id: 'B-P0031', title: 'x' })).toBeNull();
        expect(sanitizeBook({ id: 'B0009', title: 'Hůrka 1', missing: 4, onDisk: 2, download: 'none', offer: true, url: 'javascript:alert(1)', pending: 0 }))
            .toEqual({ id: 'B0009', title: 'Hůrka 1', tasks: 0, waiting: 0, open: 0, parked: 0, onDisk: 2, download: 'none' });
        // A count of images only with `need`, and only a positive one.
        expect(sanitizeBook({ id: 'B0010', title: 'x', needCount: 3, download: 'range' })).not.toHaveProperty('needCount');
        const many = { ...rawBooks(), list: Array.from({ length: 150 }, (_, i) => ({ id: `B${i + 1}`, title: `Book ${i + 1}`, download: 'none' })), more: 50 };
        expect(sanitizeBooks(many)!.list).toHaveLength(100);
    });

    it('comes into the status only with the feature; booksOn needs both', () => {
        const base = { tree: { id: TREE, name: 'Lhotští' }, head: 'h1', links: ['open', 'book'], books: rawBooks() };
        const without = sanitizeLiveStatus({ ...base, features: ['status.parts'] })!;
        expect(without.books).toBeUndefined();
        expect(booksOn(without)).toBe(false);
        const withIt = sanitizeLiveStatus({ ...base, features: [BOOKS_FEATURE] })!;
        expect(withIt.books?.list).toHaveLength(2);
        expect(booksOn(withIt)).toBe(true);
        expect(withIt.links).toContain('book');
        // The research waiting for its agent: the feature without the part.
        const noPart = sanitizeLiveStatus({ ...base, books: undefined, features: [BOOKS_FEATURE] })!;
        expect(noPart.books).toBeUndefined();
        expect(booksOn(noPart)).toBe(false);
        expect(booksOn(null)).toBe(false);
    });

    it('waiting and queued tasks name their one book', () => {
        const w = sanitizeWaiting([
            { id: 'T0412', what: 'Birth – Lhota 3, images 57–58', on: '', book: 'B0003' },
            { id: 'T0413', what: 'Several books', on: '' },
            { id: 'T0414', what: 'Bad book', on: '', book: 'Lhota' },
        ], true);
        expect(w.map(x => x.book)).toEqual(['B0003', undefined, undefined]);
        const q = sanitizeQueue([
            { id: 'T0001', text: 'Baptism', state: 'next', book: 'B0001', sameBook: 'B0001' },
            { id: 'T0002', text: 'Marriage', state: 'next' },
        ]);
        expect(q[0]).toMatchObject({ book: 'B0001', sameBook: 'B0001' });
        expect(q[1]).not.toHaveProperty('book');
    });
});

describe('the part `books` of the light status', () => {
    const BASE = 'http://127.0.0.1:5997/0123456789abcdef0123456789abcdef';
    const URL_POLL = `${BASE}/status?poll=1`;
    let reads: string[];
    let part: Record<string, unknown> | null;
    const readPart = async (url: string): Promise<unknown> => {
        reads.push(url.slice(BASE.length));
        if (url.endsWith('/books') && part) return part;
        throw new Error('HTTP 404');
    };
    beforeEach(() => { forgetStatusParts(); reads = []; part = { part: 'books', rev: 'b00c000000000001', head: 'h1', books: rawBooks() }; });

    it('is read apart when its rev changes, kept while it is the same, and absent when not said', async () => {
        const features = [STATUS_PARTS_FEATURE, BOOKS_FEATURE];
        const light = (revs: Record<string, string>) => ({ tree: { id: TREE, name: 'Lhotští' }, head: 'h1', links: [], features, parts: revs });
        const first = sanitizeLiveStatus(await completeStatus(URL_POLL, light({ books: 'b00c000000000001' }), readPart))!;
        expect(reads).toEqual(['/status/books']);
        expect(first.books?.settings.minTasks).toBe(5);
        reads = [];
        const same = sanitizeLiveStatus(await completeStatus(URL_POLL, light({ books: 'b00c000000000001' }), readPart))!;
        expect(reads).toEqual([]);
        expect(same.books?.list).toHaveLength(2);
        part = { part: 'books', rev: 'b00c000000000002', head: 'h1', books: { ...rawBooks(), settings: { minTasks: 6, minTasksOwn: true, sameBook: 'yes', sameBookOwn: true } } };
        const changed = sanitizeLiveStatus(await completeStatus(URL_POLL, light({ books: 'b00c000000000002' }), readPart))!;
        expect(reads).toEqual(['/status/books']);
        expect(changed.books?.settings).toMatchObject({ minTasks: 6, minTasksOwn: true, sameBook: 'yes' });
        // A research waiting for its agent says no part `books`: none.
        const none = sanitizeLiveStatus(await completeStatus(URL_POLL, light({}), readPart))!;
        expect(none.books).toBeUndefined();
    });
});

describe('the `book` link', () => {
    it('opens the book\'s folder by its id only, without any mark', () => {
        expect(researchSchemeUrl('book', { tree: TREE, book: 'B0003', bookDo: 'folder' }))
            .toBe(`strom-research://book?tree=${TREE}&id=B0003&do=folder`);
        expect(researchSchemeUrl('book', { tree: TREE, book: 'B0003' })).toBe(`strom-research://book?tree=${TREE}&id=B0003&do=folder`);
        expect(researchSchemeUrl('book', { tree: TREE, book: 'Lhota 3', bookDo: 'folder' })).toBeNull();
        expect(researchSchemeUrl('book', { tree: TREE })).toBeNull();
        expect(researchSchemeUrl('book', { tree: TREE, book: 'B0003', bookDo: 'open' as 'folder' })).toBeNull();
        expect(researchLinkMark('book')).toBe('none');
        expect(researchUrlMark(`strom-research-beta://book?tree=${TREE}&id=B0003&do=folder`)).toBe('none');
    });
});

describe('the books\' texts and orders', () => {
    afterEach(() => setLanguage('en'));

    it('bookById finds a book of the list only', () => {
        const books = sanitizeBooks(rawBooks())!;
        expect(bookById({ books }, 'B0001')?.title).toBe('Lhota 3, N 1784–1820');
        expect(bookById({ books }, 'B0099')).toBeNull();
        expect(bookById({}, 'B0001')).toBeNull();
        expect(bookById({ books }, undefined)).toBeNull();
    });

    it('the title carries its years once, with a dash', () => {
        expect(bookTitle({ title: 'Lhota 3, N 1784–1820', years: '1784-1820' })).toBe('Lhota 3, N 1784–1820');
        expect(bookTitle({ title: 'Lhota 3, N 1784-1820', years: '1784-1820' })).toBe('Lhota 3, N 1784-1820');
        expect(bookTitle({ title: 'Lhota 3, N', years: '1784-1820' })).toBe('Lhota 3, N 1784–1820');
        expect(bookTitle({ title: 'Lhota 3, N' })).toBe('Lhota 3, N');
        expect(dashRanges('57-58, 112')).toBe('57–58, 112');
    });

    it('images: missing only beside known images', () => {
        const en = getStringsForLang('en').live.books;
        const cs = getStringsForLang('cs').live.books;
        expect(bookImagesText({ images: 516, onDisk: 303, missing: 213 }, cs)).toBe('516 snímků · na disku 303 · chybí 213');
        expect(bookImagesText({ onDisk: 40 }, cs)).toBe('na disku 40');
        expect(bookImagesText({ onDisk: 40, missing: 3 }, en)).toBe('on disk 40');
        expect(bookImagesText({ images: 1, onDisk: 0, missing: 1 }, en)).toBe('1 image · on disk 0 · missing 1');
    });

    it('the offer: whole only with download whole, a range or a selection only with need, a count only as said', () => {
        const cs = getStringsForLang('cs').live.books;
        const de = getStringsForLang('de').live.books;
        expect(bookOfferText({ offer: true, download: 'whole', images: 727 }, cs)).toBe('Ke stažení celá kniha · 727 snímků');
        expect(bookOfferText({ offer: true, download: 'whole' }, cs)).toBe('Ke stažení celá kniha');
        expect(bookOfferText({ offer: true, download: 'range', need: '31-36', needCount: 6 }, cs)).toBe('Ke stažení snímky 31–36 · 6 snímků');
        expect(bookOfferText({ offer: true, download: 'range', need: '3', needCount: 1 }, cs)).toBe('Ke stažení snímek 3 · 1 snímek');
        expect(bookOfferText({ offer: true, download: 'range', need: '31-36' }, cs)).toBe('Ke stažení snímky 31–36');
        expect(bookOfferText({ offer: true, download: 'selected', need: '14, 88, 203', needCount: 3 }, cs)).toBe('Ke stažení vybrané snímky 14, 88, 203 · 3 snímky');
        expect(bookOfferText({ offer: true, download: 'selected', need: '14, 88, 203', needCount: 3 }, de)).toBe('Ausgewählte Bilder 14, 88, 203 herunterladbar · 3 Bilder');
        expect(bookOfferText({ offer: true, download: 'range' }, cs)).toBe('');
        expect(bookOfferText({ download: 'whole', images: 727 }, cs)).toBe('');
        expect(bookOfferText({ offer: true, download: 'none' }, cs)).toBe('');
    });

    it('Most tasks: tasks, then waiting, then the id\'s number', () => {
        const list = [
            book({ id: 'B0010', tasks: 5, waiting: 0 }), book({ id: 'B0002', tasks: 5, waiting: 0 }),
            book({ id: 'B0003', tasks: 16, waiting: 0 }), book({ id: 'B0100', tasks: 5, waiting: 2 }),
        ];
        expect([...list].sort(sortBooksMost).map(b => b.id)).toEqual(['B0003', 'B0100', 'B0002', 'B0010']);
    });

    it('Faster by downloading: offered with nothing waiting, in the order of Most tasks', () => {
        const books: LiveBooks = {
            settings: { minTasks: 5, minTasksOwn: false, sameBook: 'no', sameBookOwn: false },
            list: [
                book({ id: 'B0001', tasks: 5, waiting: 0, offer: true, download: 'whole' }),
                book({ id: 'B0002', tasks: 9, waiting: 1, offer: true }),
                book({ id: 'B0003', tasks: 11, waiting: 0, offer: true, download: 'selected' }),
                book({ id: 'B0004', tasks: 20, waiting: 0, download: 'none' }),
            ],
            more: 0,
        };
        expect(urgentBooks(books).map(b => b.id)).toEqual(['B0003', 'B0001']);
        expect(urgentBooks(undefined)).toEqual([]);
    });

    it('the head\'s second line and title; the counts first in Most tasks', () => {
        const cs = getStringsForLang('cs').live.books;
        const b = book({ archive: { name: 'Státní archiv v Lhotě' }, images: 516, missing: 213, pending: 12, access: 'online-login' });
        expect(bookMetaParts(b, {}, cs)).toEqual([
            { kind: 'archive', text: 'Státní archiv v Lhotě' },
            { kind: 'counts', text: '2 čekají · +13 ve frontě' },
            { kind: 'images', text: '516 snímků · na disku 303 · chybí 213' },
            { kind: 'pending', text: 'převezme se 12 souborů' },
            { kind: 'login', text: 'web archivu vyžaduje přihlášení' },
        ]);
        expect(bookMetaParts(b, { most: true }, cs).map(p => p.kind)).toEqual(['counts', 'archive', 'images', 'pending', 'login']);
        // Without an archive and nothing in the queue.
        expect(bookMetaParts(book({ waiting: 5, open: 0 }), {}, cs).map(p => p.text)).toEqual(['5 čeká', 'na disku 303']);
        expect(bookHeadTitle(b, cs)).toBe('Lhota 3, N · Státní archiv v Lhotě · 16 úkolů, z toho odložen 1');
        expect(bookHeadTitle(book({ parked: 0 }), getStringsForLang('en').live.books)).toBe('Lhota 3, N · 16 tasks');
        expect(bookWebUrl(book({ archive: { name: 'A', url: 'https://a.example/' } }))).toBe('https://a.example/');
        expect(bookWebUrl(book({ url: 'https://a.example/b/3', archive: { name: 'A', url: 'https://a.example/' } }))).toBe('https://a.example/b/3');
        expect(bookWebUrl(book())).toBeNull();
    });

    it('plurals in every language', () => {
        const cs = getStringsForLang('cs');
        const pl = getStringsForLang('pl');
        expect([1, 2, 5].map(n => cs.live.books.waiting(n))).toEqual(['1 čeká', '2 čekají', '5 čeká']);
        expect([1, 2, 5].map(n => pl.live.books.waiting(n))).toEqual(['1 czeka', '2 czekają', '5 czeka']);
        expect([1, 4, 5].map(n => cs.live.books.more(n))).toEqual(['a další 1 kniha je ve výzkumu', 'a další 4 knihy jsou ve výzkumu', 'a dalších 5 knih je ve výzkumu']);
        expect([1, 4, 5].map(n => pl.live.books.more(n))).toEqual(['i 1 kolejna księga jest w badaniu', 'i 4 kolejne księgi są w badaniu', 'i 5 kolejnych ksiąg jest w badaniu']);
        expect(cs.treeSettings.booksSum(5, false)).toBe('od 5 úkolů · bez přednosti');
        expect(cs.treeSettings.booksSum(1, true)).toBe('od 1 úkolu · přednost stažené');
        expect(pl.treeSettings.booksSum(1, false)).toBe('od 1 zadania · bez pierwszeństwa');
        expect(getStringsForLang('en').live.books.urgentCount(4)).toBe('4 books');
        expect(getStringsForLang('de').live.books.panelUrgent(1)).toBe('Schneller durch Herunterladen · 1 Buch ⤢');
    });
});

describe('§4 Books in the research\'s settings', () => {
    afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); setLanguage('en'); });
    const SETTINGS = { minTasks: 5, minTasksOwn: false, minTasksDefault: 5, sameBook: 'no' as const, sameBookOwn: false, sameBookDefault: 'no' as const };

    it('the bridge\'s answers typed', () => {
        const reply = { books: { settings: { ...SETTINGS, minTasks: 8, minTasksOwn: true } }, head: 'h2', parent: 'h1' };
        expect(booksSettingReply(200, reply, [])).toEqual({ ok: true, settings: { ...SETTINGS, minTasks: 8, minTasksOwn: true } });
        expect(booksSettingReply(200, {}, [])).toEqual({ ok: true });
        expect(booksSettingReply(400, { code: 'books.body' }, [])).toMatchObject({ ok: false, code: 'invalid' });
        expect(booksSettingReply(409, { code: 'directions.archive', error: 'An archive.' }, [])).toMatchObject({ ok: false, code: 'archive', reason: 'An archive.' });
        expect(booksSettingReply(503, { code: 'research.busy' }, [])).toMatchObject({ ok: false, code: 'busy' });
        expect(booksSettingReply(423, { code: 'locked' }, [])).toMatchObject({ ok: false, code: 'locked' });
        expect(booksSettingReply(507, { code: 'disk.full' }, [])).toMatchObject({ ok: false, code: 'full' });
        expect(booksSettingReply(500, { code: 'books.failed' }, [])).toMatchObject({ ok: false, code: 'unknown' });
    });

    it('the write: its path and body; no answer is the network', async () => {
        const f = vi.fn(async () => new Response(JSON.stringify({ books: { settings: { ...SETTINGS, sameBook: 'yes', sameBookOwn: true } } }), { status: 200 }));
        vi.stubGlobal('fetch', f);
        const res = await postBridgeBooks('http://127.0.0.1:1/tok', { sameBook: 'yes' }, ['books']);
        expect(res).toMatchObject({ ok: true, settings: { sameBook: 'yes', sameBookOwn: true } });
        const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
        expect(url.split('?')[0]).toBe('http://127.0.0.1:1/tok/books');
        expect(init.method).toBe('POST');
        expect(JSON.parse(String(init.body))).toEqual({ sameBook: 'yes' });
        await postBridgeBooks('http://127.0.0.1:1/tok', { minTasks: 'default' }, ['books']);
        expect(JSON.parse(String((f.mock.calls[1] as unknown as [string, RequestInit])[1].body))).toEqual({ minTasks: 'default' });
        vi.unstubAllGlobals();
        vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('down'); }));
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        expect(await postBridgeBooks('http://127.0.0.1:1/tok', { minTasks: 3 }, [])).toMatchObject({ ok: false, code: 'network' });
    });

    it('the number typed: a whole number 1–999 only', () => {
        expect(['1', ' 12 ', '999'].map(booksMinTasksInput)).toEqual([1, 12, 999]);
        expect(['0', '1000', '2.5', '-3', '', 'abc', '1e2'].map(booksMinTasksInput)).toEqual([null, null, null, null, null, null, null]);
    });

    it('a folded group with its summary; defaults marked, no reset; own values with their reset', () => {
        const ts = strings.treeSettings;
        const h = booksSettingHtml({ settings: SETTINGS, open: false, up: true });
        expect(h).not.toMatch(/<details[^>]* open/);
        expect(h).toContain(ts.booksSum(5, false));
        expect(h).toContain('research-group-value-short');
        expect((h.match(/research-transcripts-default/g) ?? []).length).toBe(2);
        expect(h).not.toContain('research-books-reset');
        expect(h).toMatch(/id="research-books-min"[^>]*min="1" max="999" step="1" value="5"/);
        expect(h).not.toContain('disabled');
        const own = booksSettingHtml({ settings: { ...SETTINGS, minTasks: 8, minTasksOwn: true, sameBook: 'yes', sameBookOwn: true }, open: true, up: true });
        expect(own).toMatch(/<details[^>]* open/);
        expect(own).not.toContain('research-transcripts-default');
        expect(own).toContain(ts.resetDefault('5'));
        expect(own).toContain(ts.resetDefault(ts.booksNo));
        expect(own).toMatch(/id="research-books-same" checked/);
        setLanguage('cs');
        expect(booksSettingHtml({ settings: { ...SETTINGS, sameBookOwn: true, sameBook: 'yes' }, open: true, up: true })).toContain('Vrátit výchozí (ne)');
    });

    it('an invalid number, saving, confirmed, busy with Try again, the bridge down', () => {
        const ts = strings.treeSettings;
        const bad = booksSettingHtml({ settings: SETTINGS, open: true, up: true, invalid: '0' });
        expect(bad).toContain('aria-invalid="true"');
        expect(bad).toContain(ts.minTasksInvalid);
        expect(bad).toMatch(/value="0"/);
        const busy = booksSettingHtml({ settings: SETTINGS, open: true, up: true, note: { kind: 'busy' } });
        expect(busy).toContain(ts.rtBusy);
        expect((busy.match(/ disabled/g) ?? []).length).toBe(2);
        expect(booksSettingHtml({ settings: SETTINGS, open: true, up: true, note: { kind: 'ok' } })).toContain(ts.booksOk);
        const err = booksSettingHtml({ settings: SETTINGS, open: true, up: true, note: { kind: 'text', text: ts.booksBusyErr, retry: true } });
        expect(err).toContain(ts.booksBusyErr);
        expect(err).toContain('research-books-retry');
        const down = booksSettingHtml({ settings: SETTINGS, open: true, up: false, note: { kind: 'text', text: strings.history.storiesBridgeDown } });
        expect(down).toContain('is-down');
        expect((down.match(/ disabled/g) ?? []).length).toBe(2);
    });
});
