/**
 * Leak test of a book of a house (spec 030 K1.4a, §10), on fixed "now"
 * (20 Nov 2026: the last ~100 years are 1926 on): with the option on (the
 * default), people of the last ~100 years — Lubor (1890–1950), Bělomíra
 * (1898–1970), Vratislav (1925–2001) and the living Bohuslava (1990) — are
 * in the whole book by name and role only: no year, place, event or couple
 * detail of theirs in the chapters, the index of people or the index of
 * houses, under any privacy. With the option off they are there as in any
 * book, the living still by the book's privacy. A book of the whole tree with
 * the index of houses limits only the index (and the Houses chapter).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrivacyMode } from '../privacy.js';
import { bookTitlePage, buildFamilyBook } from '../book.js';
import { bookHouseRecent, defaultBookOptions, type BookOptions, type BookSelectionSpec } from '../book-options.js';
import { bookOptionsFromMemory, loadBookMemory, saveBookMemory } from '../book-memory.js';
import { HOUSE_ID, HOUSE_NOW, LIVING_NAME, houseResearch, houseTree } from './helpers/house-book-fixture.js';

const HOUSE: BookSelectionSpec = { kind: 'house', place: 'Bělokamen', house: 'čp. 16' };
/** Years only people of the last ~100 years have in the fixture (their births, deaths, couple, residence). */
const RECENT_YEARS = ['1898', '1950', '1970', '1925', '2001', '1990', '2015'];
const PRIVACY: PrivacyMode[] = ['full', 'initials', 'anonymous', 'minimal'];

function book(selection: BookSelectionSpec, privacy: PrivacyMode, houseRecent?: boolean): string {
    const base = defaultBookOptions('cs');
    const opts: BookOptions = {
        ...base, selection, privacy, detail: 'all',
        parts: { ...base.parts, houses: true, houseIndex: true, index: true },
        ...(houseRecent !== undefined ? { houseRecent } : {}),
    };
    return buildFamilyBook(houseTree(), opts, {
        dateLabel: 'x', now: HOUSE_NOW, houseResearch: h => (h.id === HOUSE_ID ? houseResearch() : null),
    });
}

/** The book's text without its tags, styles and scripts, and without the note that names the boundary year. */
function text(html: string): string {
    return html
        .replace(/<style[\s\S]*?<\/style>/g, ' ').replace(/<script[\s\S]*?<\/script>/g, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/Události po roce 1925 a poloha domu se v knize neuvádějí\./g, ' ');
}

/** The part of a book with this id, up to its section's end. */
function part(html: string, id: string): string {
    const at = html.indexOf(`id="${id}"`);
    expect(at).toBeGreaterThan(0);
    return html.slice(at, html.indexOf('</section>', at));
}

describe('a book of a house: people of the last ~100 years by name and role only (K1.4a)', () => {
    beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(HOUSE_NOW); });
    afterEach(() => { vi.useRealTimers(); });

    it('on by default: no year, place or event of theirs anywhere in the book, under any privacy; their names stay', () => {
        for (const privacy of PRIVACY) {
            const html = book(HOUSE, privacy);
            const t = text(html);
            for (const y of RECENT_YEARS) expect(t, `${privacy}: ${y}`).not.toContain(y);
            // The names stay (the living as the privacy names them).
            expect(t, privacy).toContain('Lubor');
            expect(t, privacy).toContain('Vratislav');
            if (privacy === 'full') expect(t).toContain(LIVING_NAME);
            else expect(t).not.toContain(LIVING_NAME);
            // The indexes are there and name them without years.
            expect(html).toContain('id="book-index"');
            expect(part(html, 'book-index')).toContain('Vratislav');
            expect(html).toContain('id="book-house-index"');
        }
        // People before the last ~100 years keep their data.
        expect(text(book(HOUSE, 'initials'))).toContain('1820');
    });

    it('off: their data as in any book; the living still by the book\'s privacy', () => {
        const full = text(book(HOUSE, 'full', false));
        for (const y of ['1898', '1950', '1970', '2001', '1990']) expect(full).toContain(y);
        const initials = text(book(HOUSE, 'initials', false));
        expect(initials).toContain('2001');
        expect(initials).not.toContain(LIVING_NAME);
        // Initials keep the living's birth year only, nothing else of hers.
        expect(initials).not.toContain('12. 6. 1990');
        expect(initials).not.toContain('2015');
    });

    it('a book of the whole tree with the index of houses: only the index and the Houses chapter are limited', () => {
        const html = book({ kind: 'tree' }, 'full');
        const t = text(html);
        for (const y of ['1898', '1950', '1970', '2001']) expect(t).toContain(y);
        for (const id of ['book-house-index', 'book-houses']) {
            const p = text(part(html, id));
            for (const y of RECENT_YEARS) expect(p, `${id}: ${y}`).not.toContain(y);
        }
        // The option belongs to a book of a house only.
        expect(text(book({ kind: 'tree' }, 'full', true))).toContain('1970');
    });

    it('the dialog\'s title and period are the book\'s title page: from the protected tree, not the data', () => {
        const base = defaultBookOptions('cs');
        for (const privacy of PRIVACY) {
            for (const houseRecent of [undefined, false]) {
                const opts: BookOptions = { ...base, selection: HOUSE, privacy, ...(houseRecent !== undefined ? { houseRecent } : {}) };
                const front = bookTitlePage(houseTree(), opts, { now: HOUSE_NOW });
                const html = book(HOUSE, privacy, houseRecent);
                const page = part(html, 'book-title-page');
                const tag = `${privacy} ${houseRecent ?? 'on'}`;
                expect(page, tag).toContain(`<h1>${front.title}</h1>`);
                expect(page, tag).toContain(front.period ? `<div class="book-title-sub">${front.period}</div>` : '<hr');
            }
        }
        // The option on: no year of the last ~100 years, and no name after the farm where they lived.
        const on = bookTitlePage(houseTree(), { ...base, selection: HOUSE, privacy: 'initials' }, { now: HOUSE_NOW });
        expect(on.period).toBe('1820–1920');
        expect(on.title).toBe('Bělokamen čp. 16');
        // Without any protection the data as it is.
        const open = bookTitlePage(houseTree(), { ...base, selection: HOUSE, privacy: 'full', houseRecent: false }, { now: HOUSE_NOW });
        expect(open.period).toBe('1820–2001');
        expect(open.title).toBe('Bělokamen čp. 16 · U Prouzalů');
    });

    it('the option: on unless switched off, for a book of a house only; remembered like the other options', () => {
        const base = defaultBookOptions('cs');
        expect(bookHouseRecent({ ...base, selection: HOUSE })).toBe(true);
        expect(bookHouseRecent({ ...base, selection: HOUSE, houseRecent: false })).toBe(false);
        expect(bookHouseRecent({ ...base, houseRecent: true })).toBe(false);
        const map = new Map<string, string>();
        const storage = { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => { map.set(k, v); } };
        expect(bookOptionsFromMemory('cs', loadBookMemory(storage, 't1'), HOUSE).houseRecent).toBeUndefined();
        saveBookMemory(storage, 't1', { ...base, selection: HOUSE, houseRecent: false });
        expect(bookOptionsFromMemory('cs', loadBookMemory(storage, 't1'), HOUSE).houseRecent).toBe(false);
    });
});
