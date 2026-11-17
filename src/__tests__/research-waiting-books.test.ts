/**
 * Awaiting action by book (spec 105 §1, §2): an item of one book goes under
 * its book (the books first in each phase, a book in both phases when its
 * items are, the places after them, the first of them marked for "No book"),
 * the books in the order of their first item (Recommended), of their first
 * item's time (a time order) or of their tasks ("Most tasks", always by book,
 * the items within in the research's order); a book outside the research's
 * list by the title its item names, else its id. The choice of groups kept on
 * this device under the key of the old Groups switch ('0' stays none) and
 * "Most tasks" only drawn where the research says its books, the kept values
 * never rewritten. Invented archives and books only.
 */

import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { LiveBooks, LiveWaiting, sanitizeBooks, sanitizeWaiting } from '../research-link.js';
import {
    ALL_WAITING_ORDERS, BOOK_GROUP_PREFIX, FLAT_GROUP, WAITING_ORDERS, groupWaiting, isTimeOrder, listedBook, todoWaiting, waitingGroupBandLines, waitingOrdersFor, waitingPhaseLines, waitingPhases,
} from '../research-waiting.js';
import {
    WAITING_GROUPS_KEY, WAITING_ORDER_KEY, shownWaitingGroups, storeWaitingGroupMode, storeWaitingGroups, storeWaitingOrder, storedWaitingGroupMode,
    storedWaitingGroups, storedWaitingOrder, waitingGroupModesFor, waitingOrderLabel,
} from '../ui/waiting-order-ui.js';

const archive = { key: 'repo:R0001', name: 'Archiv ve Vzorově', kind: 'archive' };
const office = { key: 'to:MěÚ Vzorov', name: 'MěÚ Vzorov', kind: 'office' };

const book = (id: string, tasks: number, waiting: number, extra: Record<string, unknown> = {}) => ({
    id, title: `Vzorov ${id}`, tasks, waiting, open: tasks - waiting, parked: 0, onDisk: 0, download: 'range', ...extra,
});

const books: LiveBooks = sanitizeBooks({
    settings: { minTasks: 5, minTasksOwn: false, sameBook: 'no', sameBookOwn: false },
    // B0001 and B0002 have the same tasks: more waiting first; B0004 and B0005 equal in both: by id.
    list: [book('B0001', 9, 1), book('B0002', 9, 2), book('B0003', 16, 1), book('B0005', 3, 1), book('B0004', 3, 1)],
    more: 0,
})!;

const list = sanitizeWaiting([
    { id: 'T0001', what: 'a', kind: 'images', section: 'images', group: archive, order: 0, at: '2026-11-10T09:00:00Z', book: 'B0001' },
    { id: 'T0002', what: 'b', kind: 'letter', section: 'letter', group: office, order: 1, at: '2026-11-15T09:00:00Z' },
    { id: 'T0003', what: 'c', kind: 'images', section: 'images', group: archive, order: 2, at: '2026-11-16T08:00:00Z', book: 'B0003' },
    { id: 'T0004', what: 'd', kind: 'images', section: 'images', group: archive, order: 3, at: '2026-11-11T09:00:00Z', book: 'B0001' },
    { id: 'T0005', what: 'e', kind: 'images', section: 'images', group: archive, order: 4, at: '2026-11-12T09:00:00Z', book: 'B0002' },
    { id: 'T0006', what: 'f', kind: 'other', section: 'other', order: 5, at: '2026-11-14T09:00:00Z' },
    { id: 'T0007', what: 'g', kind: 'images', section: 'images', group: archive, order: 6, phase: 'sent', at: '2026-11-01T08:00:00Z', book: 'B0003' },
    { id: 'T0008', what: 'h', kind: 'letter', section: 'letter', group: office, order: 7, phase: 'sent', at: '2026-11-02T08:00:00Z' },
], true);

const ids = (items: readonly { id: string }[]) => items.map(w => w.id);
const keys = (groups: readonly { key: string }[]) => groups.map(g => g.key);
const byBook = { by: 'book' as const, books };

describe('Awaiting action by book', () => {
    it('Recommended: the books by their first item, then the places, the first place marked after the books', () => {
        const p = waitingPhases(list, 'all', 'recommended', true, byBook);
        expect(keys(p.todo)).toEqual(['book:B0001', 'book:B0003', 'book:B0002', 'to:MěÚ Vzorov', 'other']);
        expect(ids(p.todo[0].items)).toEqual(['T0001', 'T0004']);
        expect(p.todo.map(g => !!g.afterBooks)).toEqual([false, false, false, true, false]);
        // The book from the research's list, no place.
        expect(listedBook(p.todo[0].book)?.tasks).toBe(9);
        expect(p.todo[0].group).toBeNull();
    });

    it('a book stands in each phase its items are in', () => {
        const p = waitingPhases(list, 'all', 'recommended', true, byBook);
        expect(keys(p.sent)).toEqual(['book:B0003', 'to:MěÚ Vzorov']);
        expect(p.sent[1].afterBooks).toBe(true);
        expect(keys(p.todo)).toContain('book:B0003');
    });

    it('by archive (or without the option): exactly as before, no book and nothing marked', () => {
        const before = waitingPhases(list, 'all', 'recommended', true);
        expect(waitingPhases(list, 'all', 'recommended', true, { by: 'archive', books })).toEqual(before);
        expect(keys(before.todo)).toEqual(['repo:R0001', 'to:MěÚ Vzorov', 'other']);
        expect(before.todo.some(g => g.book || g.afterBooks)).toBe(false);
        expect(groupWaiting(todoWaiting(list))).toEqual(before.todo);
    });

    it('no item of a book: only places, nothing marked after books (5j)', () => {
        const none = list.map(w => ({ ...w, book: undefined }));
        const p = waitingPhases(none, 'all', 'recommended', true, byBook);
        expect(keys(p.todo)).toEqual(['repo:R0001', 'to:MěÚ Vzorov', 'other']);
        expect(p.todo.some(g => g.afterBooks)).toBe(false);
    });

    it('a time order: the books by the time of their first item, the places after them; without groups one list as before', () => {
        const newest = waitingPhases(list, 'all', 'newest', true, byBook);
        expect(keys(newest.todo)).toEqual(['book:B0003', 'book:B0002', 'book:B0001', 'to:MěÚ Vzorov', 'other']);
        expect(ids(newest.todo[2].items)).toEqual(['T0004', 'T0001']);
        expect(newest.todo[3].afterBooks).toBe(true);
        const oldest = waitingPhases(list, 'all', 'oldest', true, byBook);
        expect(keys(oldest.todo)).toEqual(['book:B0001', 'book:B0002', 'book:B0003', 'other', 'to:MěÚ Vzorov']);
        const flat = waitingPhases(list, 'all', 'newest', false, byBook);
        expect(keys(flat.todo)).toEqual([FLAT_GROUP]);
        expect(ids(flat.todo[0].items)).toEqual(['T0003', 'T0002', 'T0006', 'T0005', 'T0004', 'T0001']);
    });

    it('Most tasks: always by book, tasks ↓, waiting ↓, id ↑; the items within and the places in the research\'s order', () => {
        const more = sanitizeWaiting([
            ...list,
            { id: 'T0009', what: 'i', kind: 'images', section: 'images', group: archive, order: 8, book: 'B0005' },
            { id: 'T0010', what: 'j', kind: 'images', section: 'images', group: archive, order: 9, book: 'B0004' },
        ].map(w => ({ ...w, group: w.group ?? undefined })), true);
        // Even when asked by archive.
        const p = waitingPhases(more, 'all', 'most', true, { by: 'archive', books });
        expect(keys(p.todo)).toEqual(['book:B0003', 'book:B0002', 'book:B0001', 'book:B0004', 'book:B0005', 'to:MěÚ Vzorov', 'other']);
        expect(ids(p.todo[2].items)).toEqual(['T0001', 'T0004']);
        expect(p.todo[5].afterBooks).toBe(true);
        // "groups off" has no say in Most tasks.
        expect(waitingPhases(more, 'all', 'most', false, byBook)).toEqual(p);
    });

    it('Most tasks (U4 §4): to download first, then whole on disk; each part under its subheading only when both have books in the phase', () => {
        const parts: LiveBooks = sanitizeBooks({
            settings: { minTasks: 5, minTasksOwn: false, sameBook: 'no', sameBookOwn: false },
            list: [
                book('B0021', 30, 3, { images: 200, onDisk: 200, missing: 0 }),
                book('B0022', 4, 1, { images: 120, onDisk: 20, missing: 100 }),
                book('B0023', 6, 1),
                book('B0024', 12, 2, { images: 50, onDisk: 50, missing: 0 }),
            ],
            more: 0,
        })!;
        const items = sanitizeWaiting([
            { id: 'T0021', what: 'a', kind: 'images', section: 'images', group: archive, order: 0, book: 'B0021' },
            { id: 'T0022', what: 'b', kind: 'images', section: 'images', group: archive, order: 1, book: 'B0022' },
            { id: 'T0023', what: 'c', kind: 'images', section: 'images', group: archive, order: 2, book: 'B0023' },
            { id: 'T0024', what: 'd', kind: 'images', section: 'images', group: archive, order: 3, book: 'B0024' },
            // Outside the list: its images not known, the last of the books to download.
            { id: 'T0025', what: 'e', kind: 'images', section: 'images', group: archive, order: 4, book: 'B0099' },
            { id: 'T0026', what: 'f', kind: 'letter', section: 'letter', group: office, order: 5 },
            { id: 'T0027', what: 'g', kind: 'images', section: 'images', group: archive, order: 6, phase: 'sent', book: 'B0021' },
            { id: 'T0028', what: 'h', kind: 'images', section: 'images', group: archive, order: 7, phase: 'sent', book: 'B0024' },
        ], true);
        const p = waitingPhases(items, 'all', 'most', true, { by: 'book', books: parts });
        expect(keys(p.todo)).toEqual(['book:B0023', 'book:B0022', 'book:B0099', 'book:B0021', 'book:B0024', 'to:MěÚ Vzorov']);
        expect(p.todo.map(g => g.part ?? null)).toEqual([{ kind: 'download', count: 3 }, null, null, { kind: 'disk', count: 2 }, null, null]);
        // The sent phase has books whole on disk only: no subheading (counted in the phase).
        expect(keys(p.sent)).toEqual(['book:B0021', 'book:B0024']);
        expect(p.sent.some(g => g.part)).toBe(false);
        // Not in another order.
        expect(waitingPhases(items, 'all', 'recommended', true, { by: 'book', books: parts }).todo.some(g => g.part)).toBe(false);
        // The height: a line per band, one per subheading and one for "No book".
        expect(waitingPhaseLines(p.todo, () => 2)).toEqual(6 * 2 + 2 + 1);
        expect(waitingPhaseLines(p.sent, () => 2)).toEqual(4);
        expect(waitingPhaseLines([{ key: FLAT_GROUP, group: null, items: [...todoWaiting(items)] }], () => 9)).toBe(6);
    });

    it('a book outside the research\'s list: the title its item names (its record set), else its id; after the listed ones in Most tasks', () => {
        const items = sanitizeWaiting([
            { id: 'T0011', what: 'k', kind: 'images', section: 'images', group: archive, order: 0, book: 'B0011',
                inbox: { have: 0, want: 2, book: 'Vzorov 11, N 1800–1830', recordset: 'B0011', dir: '' } },
            { id: 'T0012', what: 'l', kind: 'images', section: 'images', group: archive, order: 1, book: 'B0012' },
            { id: 'T0013', what: 'm', kind: 'images', section: 'images', group: archive, order: 2, book: 'B0005' },
        ], true);
        const p = waitingPhases(items, 'all', 'recommended', true, byBook);
        expect(p.todo.map(g => g.book)).toEqual([
            { id: 'B0011', title: 'Vzorov 11, N 1800–1830' }, { id: 'B0012', title: 'B0012' }, expect.objectContaining({ id: 'B0005', tasks: 3 }),
        ]);
        expect(listedBook(p.todo[0].book)).toBeNull();
        expect(keys(waitingPhases(items, 'all', 'most', true, byBook).todo)).toEqual(['book:B0005', 'book:B0011', 'book:B0012']);
        // Without the research's list every book is outside it.
        expect(waitingPhases(items, 'all', 'recommended', true, { by: 'book' }).todo.every(g => listedBook(g.book) === null)).toBe(true);
    });

    it('a question about places stays under "Places" whatever book it names', () => {
        const items = [{ ...list[0], id: 'T0021', kind: 'place', section: 'decide', book: 'B0001' } as LiveWaiting];
        expect(keys(waitingPhases(items, 'all', 'recommended', true, byBook).todo)).toEqual(['places']);
    });

    it('a filter first, then the books', () => {
        const p = waitingPhases(list, 'letter', 'recommended', true, byBook);
        expect(keys(p.todo)).toEqual(['to:MěÚ Vzorov']);
        expect(p.todo[0].afterBooks).toBeUndefined();
        expect(BOOK_GROUP_PREFIX).toBe('book:');
    });
});

describe('the orders and the groups offered', () => {
    it('Most tasks only with the books; only the time orders are timed', () => {
        expect(waitingOrdersFor(false)).toEqual(['recommended', 'newest', 'oldest']);
        expect(waitingOrdersFor(true)).toEqual(['recommended', 'newest', 'oldest', 'most']);
        expect(WAITING_ORDERS).not.toContain('most');
        expect(ALL_WAITING_ORDERS).toContain('most');
        expect(ALL_WAITING_ORDERS.filter(isTimeOrder)).toEqual(['newest', 'oldest']);
        expect(waitingOrderLabel('most')).toBe('Most tasks');
    });

    it('the groups as drawn: Recommended without "No groups", Most tasks by book, without the books by book is by archive', () => {
        expect(waitingGroupModesFor('recommended')).toEqual(['archive', 'book']);
        expect(waitingGroupModesFor('newest')).toEqual(['archive', 'book', 'none']);
        expect(waitingGroupModesFor('most')).toEqual([]);
        expect(shownWaitingGroups('none', 'recommended', true)).toBe('archive');
        expect(shownWaitingGroups('none', 'oldest', true)).toBe('none');
        expect(shownWaitingGroups('archive', 'most', true)).toBe('book');
        expect(shownWaitingGroups('none', 'most', true)).toBe('book');
        expect(shownWaitingGroups('book', 'recommended', false)).toBe('archive');
        expect(shownWaitingGroups('book', 'newest', false)).toBe('archive');
        expect(shownWaitingGroups('none', 'newest', false)).toBe('none');
        expect(shownWaitingGroups('book', 'newest', true)).toBe('book');
    });
});

describe('the choice of groups and Most tasks kept on this device', () => {
    let store: Map<string, string>;
    beforeEach(() => {
        store = new Map();
        vi.stubGlobal('localStorage', {
            getItem: (k: string) => store.get(k) ?? null,
            setItem: (k: string, v: string) => { store.set(k, v); },
            removeItem: (k: string) => { store.delete(k); },
        });
    });
    afterEach(() => vi.unstubAllGlobals());

    it('by archive without a value; the old switch\'s "0" is none; "book" is by book', () => {
        expect(storedWaitingGroupMode()).toBe('archive');
        store.set(WAITING_GROUPS_KEY, '0');
        expect(storedWaitingGroupMode()).toBe('none');
        expect(storedWaitingGroups()).toBe(false);
        store.set(WAITING_GROUPS_KEY, 'book');
        expect(storedWaitingGroupMode()).toBe('book');
        // Code that knows nothing of the books sees groups on.
        expect(storedWaitingGroups()).toBe(true);
        store.set(WAITING_GROUPS_KEY, 'bogus');
        expect(storedWaitingGroupMode()).toBe('archive');
    });

    it('kept under the switch\'s key in its values', () => {
        storeWaitingGroupMode('book');
        expect(store.get(WAITING_GROUPS_KEY)).toBe('book');
        storeWaitingGroupMode('none');
        expect(store.get(WAITING_GROUPS_KEY)).toBe('0');
        storeWaitingGroupMode('archive');
        expect(store.has(WAITING_GROUPS_KEY)).toBe(false);
        storeWaitingGroups(false);
        expect(store.get(WAITING_GROUPS_KEY)).toBe('0');
    });

    it('Most tasks drawn only with the books, Recommended otherwise, the kept value not rewritten', () => {
        storeWaitingOrder('most');
        expect(store.get(WAITING_ORDER_KEY)).toBe('most');
        expect(storedWaitingOrder(true)).toBe('most');
        expect(storedWaitingOrder(false)).toBe('recommended');
        expect(storedWaitingOrder()).toBe('recommended');
        expect(store.get(WAITING_ORDER_KEY)).toBe('most');
        // "book" without the books: drawn by archive, still kept.
        storeWaitingGroupMode('book');
        expect(shownWaitingGroups(storedWaitingGroupMode(), storedWaitingOrder(false), false)).toBe('archive');
        expect(store.get(WAITING_GROUPS_KEY)).toBe('book');
    });

    it('storage that throws: by archive', () => {
        vi.stubGlobal('localStorage', { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); }, removeItem: () => { throw new Error('blocked'); } });
        expect(storedWaitingGroupMode()).toBe('archive');
        expect(storedWaitingOrder(true)).toBe('recommended');
        expect(() => storeWaitingGroupMode('book')).not.toThrow();
    });
});

describe('the guessed height of a group\'s band (spec 105 U4 §1, §2)', () => {
    it('a book: its title wrapped by ~70 characters up to the cap, its archive, facts and actions', () => {
        expect(waitingGroupBandLines('Vzorov 3, N 1784–1820', { book: true, listed: true })).toBe(1 + 3);
        expect(waitingGroupBandLines('x'.repeat(71), { book: true, listed: true })).toBe(2 + 3);
        expect(waitingGroupBandLines('x'.repeat(140), { book: true, listed: true })).toBe(2 + 3);
        // A title from a catalogue hundreds of characters long: never beyond the cap.
        expect(waitingGroupBandLines('x'.repeat(400), { book: true, listed: true })).toBe(3 + 3);
        // A book outside the research's list: its title only.
        expect(waitingGroupBandLines('Vzorov 11', { book: true, listed: false })).toBe(1);
    });

    it('a place: its name, its actions under it, the images its items miss', () => {
        expect(waitingGroupBandLines('Archiv ve Vzorově', {})).toBe(2);
        expect(waitingGroupBandLines('Archiv ve Vzorově', { missing: true })).toBe(3);
        expect(waitingGroupBandLines('y'.repeat(150), { missing: true })).toBe(3 + 1 + 1);
    });
});
