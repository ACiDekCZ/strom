/**
 * The family book's index of houses (spec 030 §8, K1.3) and a house in it as
 * outputs show a house (§10, K1.4): the part's availability (a house with a
 * number among the book's people), off by default and outside the presets,
 * and a leak test of a book of a house with the index — the living's name,
 * the years of people of the last ~100 years at the house, the sensitive
 * event (until revealed) and the house's location never get into the book.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HouseUserData, StromData } from '../types.js';
import type { HouseResearch } from '../house-bridge.js';
import {
    applyBookPreset, bookPartAvailability, bookPresetOf, defaultBookOptions, effectiveBookParts, estimateBook,
    type BookSelectionSpec,
} from '../book-options.js';
import { buildFamilyBook } from '../book.js';
import { HOUSE_ID, HOUSE_NOW, LIVING_NAME, SENSITIVE_TEXT, houseResearch, houseTree } from './helpers/house-book-fixture.js';

const HOUSE: BookSelectionSpec = { kind: 'house', place: 'Bělokamen', house: 'čp. 16' };

function plainTree(): StromData {
    const data = houseTree();
    for (const p of Object.values(data.persons)) {
        delete p.birthAddress;
        delete p.deathAddress;
        delete p.events;
    }
    for (const u of Object.values(data.partnerships)) delete u.address;
    delete data.houses;
    return data;
}

describe('the index of houses: the part', () => {
    it('off by default; a preset keeps it as it is and the defaults still match "For the family"', () => {
        const opts = defaultBookOptions('cs');
        expect(opts.parts.houseIndex).toBe(false);
        expect(bookPresetOf(opts)).toBe('family');
        const on = { ...opts, parts: { ...opts.parts, houseIndex: true } };
        expect(bookPresetOf(on)).toBe('family');
        expect(applyBookPreset(on, 'research').parts.houseIndex).toBe(true);
        expect(applyBookPreset(opts, 'research').parts.houseIndex).toBe(false);
    });

    it('available with a house with a number among the book\'s people and the Houses chapter, with how many houses it lists', () => {
        const data = houseTree();
        // Without the Houses chapter: only with it (spec 030 §8).
        const alone = { ...defaultBookOptions('cs'), parts: { ...defaultBookOptions('cs').parts, houseIndex: true } };
        expect(bookPartAvailability(data, alone).houseIndex).toEqual({ available: false, reason: 'Jen s kapitolou Domy.' });
        expect(effectiveBookParts(data, alone).houseIndex).toBe(false);
        const opts = { ...defaultBookOptions('cs'), parts: { ...defaultBookOptions('cs').parts, houses: true, houseIndex: true } };
        const avail = bookPartAvailability(data, opts);
        expect(avail.houseIndex).toEqual({ available: true, reason: '', note: '2 domy → osoby, roky' });
        expect(effectiveBookParts(data, opts).houseIndex).toBe(true);
        // The outline and the estimate count it.
        const without = estimateBook(data, defaultBookOptions('cs'));
        const withIt = estimateBook(data, opts);
        expect(withIt.outline).toContain('Rejstřík domů');
        expect(without.outline).not.toContain('Rejstřík domů');
    });

    it('unavailable without a house among the book\'s people, with the reason; never built', () => {
        const data = plainTree();
        const opts = { ...defaultBookOptions('en'), parts: { ...defaultBookOptions('en').parts, houseIndex: true } };
        const avail = bookPartAvailability(data, opts);
        expect(avail.houseIndex.available).toBe(false);
        expect(avail.houseIndex.reason).toBe('No house with a number among the book’s people.');
        expect(effectiveBookParts(data, opts).houseIndex).toBe(false);
        const html = buildFamilyBook(data, opts, { dateLabel: 'x', now: HOUSE_NOW });
        expect(html).not.toContain('id="book-house-index"');
    });

    it('a book of ancestors of a person without a house: unavailable even in a tree with houses', () => {
        const data = houseTree();
        data.persons['solo' as never] = {
            id: 'solo' as never, firstName: 'Radim', lastName: 'Osamělý', gender: 'male', isPlaceholder: false,
            birthDate: '1801', birthPlace: 'Hvozdnice', parentIds: [], childIds: [], partnerships: [],
        };
        const opts = { ...defaultBookOptions('cs'), selection: { kind: 'ancestors', person: 'solo', generations: 2 } as BookSelectionSpec };
        expect(bookPartAvailability(data, opts).houseIndex.available).toBe(false);
    });
});

describe('the index of houses in a book of a house: nothing protected leaks', () => {
    beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(HOUSE_NOW); });
    afterEach(() => { vi.useRealTimers(); });

    const book = (data: StromData, privacy: 'full' | 'initials', research: HouseResearch | null = houseResearch()): string =>
        buildFamilyBook(data, {
            ...defaultBookOptions('cs'), selection: HOUSE, privacy,
            parts: { ...defaultBookOptions('cs').parts, houseIndex: true },
        }, { dateLabel: 'x', now: HOUSE_NOW, houseResearch: h => (h.id === HOUSE_ID ? research : null) });
    const section = (html: string): string => {
        const at = html.indexOf('id="book-house-index"');
        expect(at).toBeGreaterThan(0);
        return html.slice(at, html.indexOf('</section>', at));
    };

    it('the index: houses by town, numbers, the name after the farm, people with their records, who married in', () => {
        const idx = section(book(houseTree(), 'initials'));
        expect(idx).toContain('<h2>Rejstřík domů</h2>');
        // Bělokamen before Mlýnkovice; the old house keeps its name after the farm, in italics.
        expect(idx.indexOf('Bělokamen')).toBeLessThan(idx.indexOf('Mlýnkovice'));
        expect(idx).toContain('<em>Na Mlýnku</em>');
        expect(idx).toContain('Prouzal Svatobor, narozen 1820, zemřel 1890');
        expect(idx).toContain('Kvitelková Kunhuta, přivdala se 1878, zemřela 1920');
        // Of the last ~100 years: name and role only.
        expect(idx).toContain('Prouzal Lubor, žil v domě');
        expect(idx).toContain('Prouzal Vratislav, žil v domě');
        // The chapters as the index of people gives them, linked.
        expect(idx).toMatch(/Prouzal Svatobor[^<]*<\/span><span class="book-index-dots"><\/span><span class="book-index-refs"><b><a href="#kap-1">1<\/a><\/b>/);
        // The research's events the filter lets through, and the sentence that something is left out.
        expect(idx).toContain('Z dějin domu:</em> 1830 Stavení postaveno po rozdělení gruntu; 1868 Požár obce; Předání gruntu bez data');
        expect(idx).toContain('Události po roce 1925 a poloha domu se v knize neuvádějí.');
    });

    it('under privacy: no living name, no years of people of the last ~100 years, no sensitive event, no location', () => {
        const html = book(houseTree(), 'initials');
        expect(html).not.toContain(LIVING_NAME);
        expect(html).not.toContain(SENSITIVE_TEXT);
        expect(html).not.toContain('U Prouzalů');
        // The sentence names the first year left out; nothing else of the last ~100 years.
        const idx = section(html).replace('Události po roce 1925 a poloha domu se v knize neuvádějí.', '');
        for (const y of ['1950', '1925', '2001', '2015', '1962', '1948']) expect(idx).not.toContain(y);
        expect(idx).not.toContain('Přestavba stodoly');
        expect(html).not.toMatch(/49\.5|15\.2[01]?\b/);
    });

    it('a sensitive event revealed by a person shows; the rest stays protected', () => {
        const data = houseTree();
        (data.houses![HOUSE_ID] as HouseUserData).revealInOutputs = ['e9'];
        const html = book(data, 'initials');
        expect(section(html)).toContain(`1948 ${SENSITIVE_TEXT}`);
        expect(html).not.toContain(LIVING_NAME);
        expect(section(html)).not.toContain('Přestavba stodoly');
    });

    it('with full data: the house of the last ~100 years keeps its name, its people of the last ~100 years still without years', () => {
        const idx = section(book(houseTree(), 'full'));
        expect(idx).toContain('<em>U Prouzalů</em>');
        expect(idx).toContain('Prouzal Lubor, žil v domě');
        expect(idx).not.toContain(SENSITIVE_TEXT);
        for (const y of ['1950', '2001', '2015']) expect(idx).not.toContain(y);
    });

    it('married in without a wedding at the house: marked first, with the wedding\'s year', () => {
        const data = houseTree();
        delete data.partnerships['u2' as never].address;
        expect(section(book(data, 'initials'))).toContain('Kvitelková Kunhuta, přivdala se 1878, zemřela 1920');
    });

    it('without the research read: the tree\'s records only', () => {
        const idx = section(book(houseTree(), 'initials', null));
        expect(idx).not.toContain('Z dějin domu');
        expect(idx).toContain('Prouzal Svatobor, narozen 1820, zemřel 1890');
    });

    it('the contents and the side list name the index of houses', () => {
        const html = book(houseTree(), 'initials');
        expect(html).toContain('<li class="book-toc-rod"><a href="#book-house-index">Rejstřík domů</a></li>');
        expect(html.match(/href="#book-house-index"/g)!.length).toBeGreaterThanOrEqual(2);
    });
});
