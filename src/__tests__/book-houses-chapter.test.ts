/**
 * The Houses chapter of the family book (spec 030 §8, K7.3): the part's
 * availability (a house of the book's people with its history done or above
 * the threshold) and its default (on when the tree has a house with its
 * history done), the index of houses only with the chapter (a book of a
 * house keeps it, K1.3), and the chapter as outputs show a house (§10): the
 * introduction, the house's heading, its name after the farm, its timeline,
 * holders and residents with the research's sources as notes — never the
 * living's name, the years of people of the last ~100 years, the sensitive
 * event, the stranger of today or the location.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HouseId, PersonId, StromData } from '../types.js';
import {
    applyBookPreset, bookHouseDefaults, bookPartAvailability, bookPresetOf, defaultBookOptions, defaultBookParts, effectiveBookParts,
    estimateBook, type BookSelectionSpec,
} from '../book-options.js';
import { buildFamilyBook } from '../book.js';
import { bookOptionsFromMemory, loadBookMemory, saveBookMemory } from '../book-memory.js';
import { HOUSE_ID, HOUSE_NOW, LIVING_NAME, SENSITIVE_TEXT, houseResearch, houseTree } from './helpers/house-book-fixture.js';

const HOUSE: BookSelectionSpec = { kind: 'house', place: 'Bělokamen', house: 'čp. 16' };

/** A tree whose only house has one person once: below the threshold. */
function smallHouseTree(): StromData {
    const data = houseTree();
    for (const p of Object.values(data.persons)) {
        delete p.birthAddress;
        delete p.deathAddress;
        delete p.events;
    }
    for (const u of Object.values(data.partnerships)) delete u.address;
    delete data.houses;
    data.persons['svatobor' as PersonId].birthAddress = 'čp. 16';
    return data;
}

const withSources = (data: StromData): StromData => {
    data.sources = {
        s1: { id: 's1', title: 'Pozemková kniha Bělokamen 1820–1900', refn: 'S0001' },
        s3: { id: 's3', title: 'Gruntovní kniha Zálesí', refn: 'S0003' },
    } as unknown as StromData['sources'];
    return data;
};

describe('the Houses chapter: the part', () => {
    it('off by default and outside the presets; on by default when the tree has a house with its history done', () => {
        const opts = defaultBookOptions('cs');
        expect(opts.parts.houses).toBe(false);
        expect(bookPresetOf({ ...opts, parts: { ...opts.parts, houses: true } })).toBe('family');
        expect(applyBookPreset({ ...opts, parts: { ...opts.parts, houses: true } }, 'research').parts.houses).toBe(true);
        expect(bookHouseDefaults({})).toBe(false);
        expect(bookHouseDefaults({ finishedHouses: new Set() })).toBe(false);
        expect(bookHouseDefaults({ finishedHouses: new Set([HOUSE_ID as HouseId]) })).toBe(true);
        expect(defaultBookParts(true)).toMatchObject({ houses: true, houseIndex: true, index: true });
    });

    it('available with a house above the threshold, with how many houses and pages; the outline names it', () => {
        const data = houseTree();
        const opts = { ...defaultBookOptions('cs'), parts: { ...defaultBookOptions('cs').parts, houses: true } };
        const avail = bookPartAvailability(data, opts);
        expect(avail.houses.available).toBe(true);
        expect(avail.houses.note).toMatch(/^2 domy · asi \d+ stran?y?$/);
        expect(estimateBook(data, opts).outline).toContain('Domy');
        expect(estimateBook(data, defaultBookOptions('cs')).outline).not.toContain('Domy');
    });

    it('unavailable without a house with history or above the threshold, with the reason; a house done by the research is in', () => {
        const data = smallHouseTree();
        const opts = { ...defaultBookOptions('en'), parts: { ...defaultBookOptions('en').parts, houses: true, houseIndex: true } };
        const avail = bookPartAvailability(data, opts);
        expect(avail.houses).toEqual({ available: false, reason: 'The tree has no house with history or above the threshold.' });
        // The index of houses goes with the chapter.
        expect(avail.houseIndex).toEqual({ available: false, reason: 'Only with the Houses chapter.' });
        expect(buildFamilyBook(data, opts, { dateLabel: 'x', now: HOUSE_NOW })).not.toContain('id="book-houses"');
        const done = new Set([HOUSE_ID as HouseId]);
        expect(bookPartAvailability(data, opts, { finishedHouses: done }).houses.available).toBe(true);
        expect(effectiveBookParts(data, opts, { finishedHouses: done })).toMatchObject({ houses: true, houseIndex: true });
        expect(buildFamilyBook(data, opts, { dateLabel: 'x', now: HOUSE_NOW, finishedHouses: done })).toContain('id="book-houses"');
    });

    it('the memory: the house parts follow the tree while it could not have them; a choice made with them is kept', () => {
        const map = new Map<string, string>();
        const storage = { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => { map.set(k, v); } };
        const tree = { kind: 'tree' } as const;
        // Saved while the tree had no house for the chapter: not kept, so a house done later turns them on.
        saveBookMemory(storage, 't1', defaultBookOptions('cs'), { omitParts: ['houses', 'houseIndex'] });
        const memory = loadBookMemory(storage, 't1');
        expect(memory?.parts).not.toHaveProperty('houses');
        expect(bookOptionsFromMemory('cs', memory, tree, true).parts).toMatchObject({ houses: true, houseIndex: true });
        expect(bookOptionsFromMemory('cs', memory, tree, false).parts).toMatchObject({ houses: false, houseIndex: false });
        // Unticked while available: kept off.
        saveBookMemory(storage, 't1', { ...defaultBookOptions('cs'), parts: { ...defaultBookParts(true), houses: false } });
        expect(bookOptionsFromMemory('cs', loadBookMemory(storage, 't1'), tree, true).parts.houses).toBe(false);
    });

    it('a book of a house keeps its index of houses without the chapter (K1.3)', () => {
        const data = smallHouseTree();
        const opts = { ...defaultBookOptions('cs'), selection: HOUSE, parts: { ...defaultBookOptions('cs').parts, houseIndex: true } };
        expect(bookPartAvailability(data, opts).houseIndex.available).toBe(true);
    });
});

describe('the Houses chapter in the book: as outputs show a house', () => {
    beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(HOUSE_NOW); });
    afterEach(() => { vi.useRealTimers(); });

    const book = (data: StromData, privacy: 'full' | 'initials', selection: BookSelectionSpec = { kind: 'tree' }): string =>
        buildFamilyBook(data, {
            ...defaultBookOptions('cs'), selection, privacy,
            parts: { ...defaultBookOptions('cs').parts, houses: true },
        }, { dateLabel: 'x', now: HOUSE_NOW, houseResearch: h => (h.id === HOUSE_ID ? houseResearch() : null) });
    const chapter = (html: string): string => {
        const at = html.indexOf('id="book-houses"');
        expect(at).toBeGreaterThan(0);
        return html.slice(at, html.indexOf('</section>', at));
    };

    it('the introduction, each house with its heading, timeline, holders and residents, the sources as notes; in the contents', () => {
        const html = book(withSources(houseTree()), 'full');
        const ch = chapter(html);
        expect(ch).toContain('Domy, ve kterých rod žil aspoň dvě generace nebo třicet let.');
        expect(ch).toContain('<h3>Bělokamen čp.\u00a016</h3>');
        expect(ch).toContain('<h3>Mlýnkovice čp.\u00a03</h3>');
        expect(ch).toContain('<em>U Prouzalů</em>');
        expect(ch).toContain('Časová osa');
        expect(ch).toContain('Stavení postaveno po rozdělení gruntu<sup class="book-house-fn-mark">1</sup>');
        expect(ch).toContain('Držitelé');
        expect(ch).toContain('Svatobor Prouzal');
        expect(ch).toContain('dědictví');
        expect(ch).toContain('Obyvatelé');
        expect(ch).toContain('hospodář');
        expect(ch).toContain('Pozemková kniha Bělokamen 1820–1900');
        expect(ch).toContain('Gruntovní kniha Zálesí');
        expect(ch).toContain('Zajímavosti:');
        // The contents and the side list name it.
        expect(html).toContain('<a href="#book-houses">Domy</a>');
        expect(html).toContain('href="#book-houses"');
    });

    it('nothing protected leaks: the living, the years of the last ~100 years, the sensitive event, the stranger, the location', () => {
        for (const privacy of ['initials', 'full'] as const) {
            const ch = chapter(book(withSources(houseTree()), privacy));
            // The living as the book's privacy names them (full data names them, as the index of houses does).
            if (privacy === 'initials') expect(ch).not.toContain(LIVING_NAME);
            expect(ch).not.toContain(SENSITIVE_TEXT);
            expect(ch).not.toContain('Kvido Stranný');
            expect(ch).not.toContain('Přestavba stodoly');
            for (const year of ['1926', '1950', '1962', '1970', '2001', '2015']) expect(ch).not.toContain(year);
            // One family's years end with the last record shown (1820–1920), not with the living's of 2015.
            expect(ch).toContain('Jedna rodina 100 let');
            expect(ch).not.toContain('49.5');
            expect(ch).not.toContain('15.2');
            // The note says what is left out: with the locations on (spec 145 T3), that of a house with people of those years.
            expect(ch).toContain('Události po roce 1925 a poloha domu s lidmi těchto let se v knize neuvádějí.');
            // Lubor (1890–1950) is of the last ~100 years: a holder by name only.
            expect(ch).toMatch(/Lubor Prouzal(<sup[^>]*>\d+<\/sup>)?<\/td><td><\/td>/);
        }
    });

    it('under privacy the house of the last ~100 years loses its name after the farm', () => {
        expect(chapter(book(houseTree(), 'initials'))).not.toContain('U Prouzalů');
        expect(chapter(book(houseTree(), 'full'))).toContain('U Prouzalů');
    });
});
