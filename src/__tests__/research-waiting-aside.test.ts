/**
 * Files of a book's inbox set aside (`inbox.aside`, Strom Research 1.36):
 * `/status.books.aside` read only with the feature, each file a decision of
 * Awaiting action under its book (by book and by archive alike), counted in
 * the section's chips, kept on this device and read back; the answer's
 * buttons, its sentence and how a refused answer ends (404: gone at once),
 * and the overview window's ask checked. Invented books and files (Lhota).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { INBOX_ASIDE_FEATURE, asideFileName, asideWaiting, asideWaitingId, sanitizeBookAside, sanitizeLiveStatus } from '../research-link.js';
import { BOOK_GROUP_PREFIX, groupWaiting, waitingChips, waitingPhases, waitingTodoCount } from '../research-waiting.js';
import { noteResearchWaiting, storedResearchWaiting } from '../research-device.js';
import { answerBookAside, asideAnswers, asideOutcomeOf, asideWaitingText, readAsideOutcome } from '../research-aside.js';
import { readOverviewAction } from '../windows/overview-window.js';
import { strings } from '../strings.js';

const TREE = '3c1d9e40-5a6b-4c7d-8e9f-0a1b2c3d4e5f';

const other = { file: '3.jpg.other-than-M0042', recordset: 'B0001', image: 3, kind: 'other', media: 'M0042', at: '2026-11-19T17:20:11.000Z' };
const same = { file: '10.jpg.same-as-M0041', recordset: 'B0001', image: 10, kind: 'same', media: 'M0041', at: '2026-11-19T17:05:02.000Z' };

function status(features: string[], aside: unknown[] = [other, same]): Record<string, unknown> {
    return {
        tree: { id: TREE, name: 'Lhotákovi' },
        features,
        waiting: [
            { id: 'T0001', what: 'Uložit snímky matriky Lhota 1', kind: 'images', section: 'images', order: 0, at: '2026-11-19T09:00:00Z', book: 'B0001',
                group: { key: 'repo:R0001', name: 'Archiv v Lhotě', kind: 'archive' } },
            { id: 'T0002', what: 'Napsat faře v Lhotě', kind: 'letter', section: 'letter', order: 1, at: '2026-11-18T09:00:00Z',
                group: { key: 'to:Fara Lhota', name: 'Fara Lhota', kind: 'office' } },
        ],
        books: {
            settings: { minTasks: 5, minTasksOwn: false, sameBook: 'no', sameBookOwn: false },
            list: [{ id: 'B0001', title: 'Matrika Lhota 1, N 1784–1820', tasks: 6, waiting: 1, open: 5, parked: 0, onDisk: 0, download: 'none' }],
            more: 0,
            aside,
        },
    };
}

const ids = (items: readonly { id: string }[]) => items.map(w => w.id);

describe('files of a book\'s inbox set aside', () => {
    it('are read only with inbox.aside: without it the field is left alone', () => {
        const without = sanitizeLiveStatus(status(['books', 'waiting.groups']))!;
        expect(ids(without.waiting)).toEqual(['T0001', 'T0002']);
        expect(without.books?.aside).toBeUndefined();

        const withIt = sanitizeLiveStatus(status(['books', 'waiting.groups', INBOX_ASIDE_FEATURE]))!;
        expect(withIt.books?.aside).toHaveLength(2);
        const items = withIt.waiting.filter(w => w.kind === 'aside');
        expect(ids(items)).toEqual(['aside:B0001/3.jpg.other-than-M0042', 'aside:B0001/10.jpg.same-as-M0041']);
        // A decision under its book.
        expect(items.map(w => [w.section, w.book, w.aside?.kind])).toEqual([['decide', 'B0001', 'other'], ['decide', 'B0001', 'same']]);
        // Without the books' feature, no books and no files set aside.
        expect(sanitizeLiveStatus(status([INBOX_ASIDE_FEATURE]))!.waiting.some(w => w.kind === 'aside')).toBe(false);
    });

    it('takes only a file it can answer: a plain name, a book, a kind and a saved image', () => {
        expect(sanitizeBookAside(other)).toEqual(other);
        const { image: _n, ...noNumber } = other;
        expect(sanitizeBookAside(noNumber)).toEqual(noNumber);
        expect(sanitizeBookAside({ ...other, file: '../3.jpg' })).toBeNull();
        expect(sanitizeBookAside({ ...other, file: '' })).toBeNull();
        expect(sanitizeBookAside({ ...other, kind: 'sharper' })).toBeNull();
        expect(sanitizeBookAside({ ...other, media: 'S0042' })).toBeNull();
        expect(sanitizeBookAside({ ...other, recordset: '' })).toBeNull();
        // A file said twice: once.
        const s = sanitizeLiveStatus(status(['books', INBOX_ASIDE_FEATURE], [other, other, same]))!;
        expect(s.books?.aside).toHaveLength(2);
    });

    it('stand under their book by book and by archive, never under "No book"; counted as decisions', () => {
        const s = sanitizeLiveStatus(status(['books', 'waiting.groups', INBOX_ASIDE_FEATURE]))!;
        const key = `${BOOK_GROUP_PREFIX}B0001`;
        // By book: the book's group holds its task and both files.
        const byBook = groupWaiting(s.waiting, { by: 'book', books: s.books });
        expect(byBook.map(g => g.key)).toEqual([key, 'to:Fara Lhota']);
        expect(ids(byBook[0].items)).toEqual(['T0001', 'aside:B0001/3.jpg.other-than-M0042', 'aside:B0001/10.jpg.same-as-M0041']);
        expect(byBook[1].afterBooks).toBe(true);
        // By archive: the task under its archive, the files under their book, no "No book" before the places.
        const byPlace = groupWaiting(s.waiting, { books: s.books });
        const book = byPlace.find(g => g.key === key)!;
        expect(ids(book.items)).toEqual(['aside:B0001/3.jpg.other-than-M0042', 'aside:B0001/10.jpg.same-as-M0041']);
        expect(ids(byPlace.find(g => g.key === 'repo:R0001')!.items)).toEqual(['T0001']);
        expect(byPlace.some(g => g.afterBooks)).toBe(false);
        // The phases as drawn: the same, the book's group in "to do".
        const phases = waitingPhases(s.waiting, 'all', 'recommended', true, { books: s.books });
        expect(phases.todo.find(g => g.key === key)?.items).toHaveLength(2);
        // Counted: the heading's count and the section's chip.
        expect(waitingTodoCount(s.waiting)).toBe(4);
        expect(waitingChips(s.waiting).find(c => c.section === 'decide')?.count).toBe(2);
    });

    describe('kept on this device', () => {
        let store: Map<string, string>;
        beforeEach(() => {
            store = new Map();
            vi.stubGlobal('localStorage', {
                getItem: (k: string) => store.get(k) ?? null,
                setItem: (k: string, v: string) => { store.set(k, v); },
                removeItem: (k: string) => { store.delete(k); },
                key: (i: number) => [...store.keys()][i] ?? null,
                get length() { return store.size; },
            });
        });
        afterEach(() => vi.unstubAllGlobals());

        it('as the research said them, made items again when read', () => {
            const s = sanitizeLiveStatus(status(['books', 'waiting.groups', INBOX_ASIDE_FEATURE]))!;
            noteResearchWaiting(TREE, s.waiting, { features: s.features });
            const back = storedResearchWaiting(TREE)!.items;
            expect(ids(back)).toEqual(ids(s.waiting));
            const a = back.find(w => w.kind === 'aside')!;
            expect(a).toEqual(s.waiting.find(w => w.id === a.id));
        });
    });

    it('answer as the kind allows: other keep / take / another number, same only the bin', () => {
        expect(asideAnswers({ kind: 'other', image: 3 })).toEqual(['discard', 'take', 'image']);
        expect(asideAnswers({ kind: 'other' })).toEqual(['discard', 'image']);
        expect(asideAnswers({ kind: 'same', image: 10 })).toEqual(['discard']);
    });

    it('say the file, the saved image and the book (its title, else its id)', () => {
        const T = strings.live.aside;
        const [o, sm] = asideWaiting({ aside: [sanitizeBookAside(other)!, sanitizeBookAside(same)!] });
        // The file by the name it came with, never the research's mark of it.
        expect(asideWaitingText(o, 'Matrika Lhota 1', T)).toBe(T.other('3.jpg', 3, 'M0042', 'Matrika Lhota 1'));
        expect(asideWaitingText(o, null, T)).toContain('B0001');
        expect(asideWaitingText(sm, 'Matrika Lhota 1', T)).toBe(T.same('10.jpg', 'M0041'));
        expect(asideWaitingId(other)).toBe('aside:B0001/3.jpg.other-than-M0042');
        // No item text addresses anyone (CLAUDE.md: impersonal texts).
        for (const t of [T.other('a', 3, 'M1', 'b'), T.same('a', 'M1'), T.folderHint, T.keep(3), T.take(3), T.another, T.numLabel, T.bin, T.taken(3), T.sameOnly, T.notSaved]) {
            expect(t).not.toMatch(/\b(you|your)\b/i);
        }
    });

    it('show the name the file came with (`name`), else the file without the research\'s mark; its id and answer keep the file', () => {
        const T = strings.live.aside;
        const named = { ...other, name: 'sken 3 (opraveny).jpg' };
        // The name passes the check and is kept; one that is no plain name is left out.
        expect(sanitizeBookAside(named)).toEqual(named);
        expect(sanitizeBookAside({ ...other, name: '../x.jpg' })).toEqual(other);
        expect(sanitizeBookAside({ ...other, name: ' x.jpg' })).toEqual(other);
        expect(sanitizeBookAside({ ...other, name: 7 })).toEqual(other);
        const [w] = asideWaiting({ aside: [sanitizeBookAside(named)!] });
        expect(w.what).toBe('sken 3 (opraveny).jpg');
        expect(asideWaitingText(w, 'Matrika Lhota 1', T)).toBe(T.other('sken 3 (opraveny).jpg', 3, 'M0042', 'Matrika Lhota 1'));
        expect(w.id).toBe('aside:B0001/3.jpg.other-than-M0042');
        expect(w.aside?.file).toBe('3.jpg.other-than-M0042');
        // Without a name: the mark cut off; a file without one as it is.
        expect(asideWaiting({ aside: [sanitizeBookAside(other)!, sanitizeBookAside(same)!] }).map(x => x.what)).toEqual(['3.jpg', '10.jpg']);
        expect(asideFileName({ file: 'scan.other-than-M0001' })).toBe('scan');
        expect(asideFileName({ file: 'scan.jpg' })).toBe('scan.jpg');
        expect(asideFileName({ file: '.other-than-M0001' })).toBe('.other-than-M0001');
        // Kept on this device with its name (the stored items are read through the same check).
        const s = sanitizeLiveStatus(status(['books', INBOX_ASIDE_FEATURE], [named, same]))!;
        expect(s.books?.aside?.[0].name).toBe('sken 3 (opraveny).jpg');
    });

    it('a refused answer: 404 gone at once, 409 the number taken or the bin only, busy with Try again', () => {
        const T = strings.live.aside;
        const r = (status: number, errorCode: string, code: 'none' | 'conflict' | 'busy' | 'network' | 'failed') =>
            ({ ok: false as const, code, status, errorCode, retryAfter: null, reason: '' });
        expect(asideOutcomeOf(r(404, 'aside.unknown', 'none'), undefined, T, 'busy', 'down')).toEqual({ ok: false, gone: true });
        expect(asideOutcomeOf(r(409, 'aside.taken', 'conflict'), 7, T, 'busy', 'down')).toEqual({ ok: false, text: T.taken(7), retry: false, tone: 'danger' });
        expect(asideOutcomeOf(r(409, 'aside.same', 'conflict'), undefined, T, 'busy', 'down')).toMatchObject({ text: T.sameOnly, retry: false });
        expect(asideOutcomeOf(r(503, 'research.busy', 'busy'), undefined, T, 'busy', 'down')).toEqual({ ok: false, text: 'busy', retry: true, tone: 'warn' });
        expect(asideOutcomeOf(r(0, '', 'network'), undefined, T, 'busy', 'down')).toMatchObject({ text: 'down', retry: true });
        // As the overview's window gets it back.
        expect(readAsideOutcome({ ok: true })).toEqual({ ok: true });
        expect(readAsideOutcome({ ok: false, gone: true })).toEqual({ ok: false, gone: true });
        expect(readAsideOutcome({ ok: false, text: 'x', retry: true, tone: 'warn' })).toEqual({ ok: false, text: 'x', retry: true, tone: 'warn' });
        expect(readAsideOutcome(null)).toBeNull();
        expect(readAsideOutcome({ ok: false })).toBeNull();
    });

    it('writes `POST books/aside` with the file and the answer; a number only with "image"', async () => {
        const sent: { url: string; body: unknown }[] = [];
        vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
            sent.push({ url, body: JSON.parse(String(init.body)) });
            return new Response(JSON.stringify({ done: 'image', added: ['M0050'], replaced: [], aside: [same], head: 'a'.repeat(40) }), { status: 200 });
        });
        try {
            const r = await answerBookAside('http://127.0.0.1:5997/tok', other.file, 'image', 7);
            expect(r.ok).toBe(true);
            if (r.ok) {
                expect(r.done).toBe('image');
                expect(r.aside.map(a => a.file)).toEqual([same.file]);
            }
            expect(sent[0].url).toMatch(/\/tok\/books\/aside/);
            expect(sent[0].body).toEqual({ file: other.file, do: 'image', image: 7 });
            // No number for another number: not sent.
            expect((await answerBookAside('http://127.0.0.1:5997/tok', other.file, 'image')).ok).toBe(false);
            expect(sent).toHaveLength(1);
        } finally {
            vi.unstubAllGlobals();
        }
    });

    it('the overview window\'s ask is checked: a known answer, a whole number only with "image"', () => {
        expect(readOverviewAction('waiting-aside', { itemId: 'aside:B0001/3.jpg', do: 'take' })).toEqual({ action: 'waiting-aside', args: { itemId: 'aside:B0001/3.jpg', do: 'take' } });
        expect(readOverviewAction('waiting-aside', { itemId: 'aside:B0001/3.jpg', do: 'image', image: 7 }))
            .toEqual({ action: 'waiting-aside', args: { itemId: 'aside:B0001/3.jpg', do: 'image', image: 7 } });
        expect(readOverviewAction('waiting-aside', { itemId: 'aside:B0001/3.jpg', do: 'image' })).toBeNull();
        expect(readOverviewAction('waiting-aside', { itemId: 'aside:B0001/3.jpg', do: 'image', image: 2.5 })).toBeNull();
        expect(readOverviewAction('waiting-aside', { itemId: 'aside:B0001/3.jpg', do: 'take', image: 7 })).toBeNull();
        expect(readOverviewAction('waiting-aside', { itemId: 'aside:B0001/3.jpg', do: 'delete' })).toBeNull();
        expect(readOverviewAction('waiting-aside', { do: 'discard' })).toBeNull();
    });
});
