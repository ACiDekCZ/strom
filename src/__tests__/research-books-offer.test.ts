/**
 * "Faster by downloading" and the small panel with the research's books
 * (spec 105 §3, §5): the books offered that nothing waits for, shown under the
 * filter All or Images only, searching only those whose title or archive
 * match; the panel's first rows to do in the order and groups chosen, a group
 * keeping how many it has in all, the focus's items all shown, "No book"
 * before the first place after a book and the rest counted as before.
 * Invented archives and books only.
 */

import { describe, it, expect } from 'vitest';
import { LiveBooks, sanitizeBooks, sanitizeWaiting } from '../research-link.js';
import { urgentBooksShown } from '../research-books.js';
import { FLAT_GROUP, panelWaiting, panelWaitingGroups } from '../research-waiting.js';
import { tokenize } from '../section-search-match.js';

const archive = { key: 'repo:R0001', name: 'Archiv ve Vzorově', kind: 'archive' };
const office = { key: 'to:MěÚ Vzorov', name: 'MěÚ Vzorov', kind: 'office' };

const book = (id: string, tasks: number, waiting: number, extra: Record<string, unknown> = {}) => ({
    id, title: `Matrika Vzorov ${id}`, tasks, waiting, open: tasks - waiting, parked: 0, onDisk: 0, download: 'whole', offer: true,
    archive: { name: 'Archiv ve Vzorově' }, ...extra,
});

const books: LiveBooks = sanitizeBooks({
    settings: { minTasks: 5, minTasksOwn: false, sameBook: 'no', sameBookOwn: false },
    list: [
        book('B0001', 9, 2),
        book('B0002', 12, 0, { title: 'Pozemková kniha Lhota', archive: { name: 'Zemský archiv v Lhotě' } }),
        book('B0003', 7, 0, { offer: false }),
        book('B0004', 6, 0, { title: 'Sčítání Vzorov 1880' }),
        book('B0005', 6, 0, { title: 'Matrika bez archivu', archive: undefined }),
    ],
    more: 3,
})!;

const items = sanitizeWaiting([
    { id: 'T0001', what: 'a', kind: 'images', section: 'images', group: archive, order: 0, book: 'B0001' },
    { id: 'T0002', what: 'b', kind: 'letter', section: 'letter', group: office, order: 1 },
    { id: 'T0003', what: 'c', kind: 'images', section: 'images', group: archive, order: 2, book: 'B0001' },
    { id: 'T0004', what: 'd', kind: 'images', section: 'images', group: archive, order: 3, book: 'B0006' },
    { id: 'T0005', what: 'e', kind: 'letter', section: 'letter', group: office, order: 4 },
    { id: 'T0006', what: 'f', kind: 'other', section: 'other', order: 5 },
    { id: 'T0007', what: 'g', kind: 'letter', section: 'letter', group: office, order: 6 },
    { id: 'T0008', what: 'h', kind: 'letter', section: 'letter', group: office, order: 7, phase: 'sent' },
], true);

const ids = (list: readonly { id: string }[]) => list.map(x => x.id);

describe('Faster by downloading', () => {
    it('the books offered that nothing waits for, by their tasks; under All and Images only', () => {
        expect(ids(urgentBooksShown(books, 'all'))).toEqual(['B0002', 'B0004', 'B0005']);
        expect(ids(urgentBooksShown(books, 'images'))).toEqual(['B0002', 'B0004', 'B0005']);
        expect(urgentBooksShown(books, 'letter')).toEqual([]);
        expect(urgentBooksShown(books, 'decide')).toEqual([]);
        expect(urgentBooksShown(null, 'all')).toEqual([]);
    });

    it('searching: only the books whose title or archive match (without an archive by the title alone)', () => {
        expect(ids(urgentBooksShown(books, 'all', tokenize('lhota')))).toEqual(['B0002']);
        expect(ids(urgentBooksShown(books, 'all', tokenize('zemsky archiv')))).toEqual(['B0002']);
        expect(ids(urgentBooksShown(books, 'all', tokenize('Vzorově')))).toEqual(['B0004']);
        expect(ids(urgentBooksShown(books, 'all', tokenize('matrika')))).toEqual(['B0005']);
        expect(urgentBooksShown(books, 'all', tokenize('dopis'))).toEqual([]);
    });
});

describe('the small panel with the books', () => {
    it('by book: the first five to do in that order, the books first, "No book" before the first place, the totals kept', () => {
        const p = panelWaitingGroups(items, 'recommended', true, { by: 'book', books });
        expect(p.groups.map(g => g.rows.key)).toEqual(['book:B0001', 'book:B0006', 'to:MěÚ Vzorov']);
        expect(p.groups.map(g => ids(g.rows.items))).toEqual([['T0001', 'T0003'], ['T0004'], ['T0002', 'T0005']]);
        expect(p.groups.map(g => g.total)).toEqual([2, 1, 3]);
        expect(p.groups.map(g => !!g.rows.afterBooks)).toEqual([false, false, true]);
        // As many more as the panel without the books says (the sent item never counts).
        expect(p.more).toBe(panelWaiting(items).more);
        expect(p.shown + p.more).toBe(7);
    });

    it('by archive: the places, no "No book"; one list in a time order without groups', () => {
        const p = panelWaitingGroups(items, 'recommended', true, {});
        expect(p.groups.map(g => g.rows.key)).toEqual(['repo:R0001', 'to:MěÚ Vzorov']);
        expect(p.groups.some(g => g.rows.afterBooks)).toBe(false);
        const flat = panelWaitingGroups(items, 'newest', false, {});
        expect(flat.groups.map(g => g.rows.key)).toEqual([FLAT_GROUP]);
        expect(flat.groups[0].rows.items).toHaveLength(5);
    });

    it('the focus\'s items all shown, however far down they stand', () => {
        const p = panelWaitingGroups(items, 'recommended', true, { by: 'book', books }, 2, new Set(['T0006', 'T0007']));
        expect(p.groups.flatMap(g => ids(g.rows.items)).sort()).toEqual(['T0006', 'T0007']);
        expect(p.more).toBe(5);
        // A group without a row goes; "No book" stands before the first place drawn.
        expect(p.groups.map(g => g.rows.key)).toEqual(['to:MěÚ Vzorov', 'other']);
        expect(p.groups.some(g => g.rows.afterBooks)).toBe(false);
    });

    it('"Most tasks": the books by their tasks first', () => {
        const p = panelWaitingGroups(items, 'most', true, { books });
        expect(p.groups[0].rows.key).toBe('book:B0001');
        expect(p.groups.find(g => g.rows.afterBooks)?.rows.key).toBe('to:MěÚ Vzorov');
    });
});
