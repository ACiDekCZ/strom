/**
 * The family book's house selection (spec 030 §8, K1.3): the people with a
 * record at the house (the children born there among them) with their spouses
 * and families, a house without people, the title from the town, the number
 * and the name after the farm (kept out under privacy where people of the last
 * ~100 years lived, §10), and the selection's way through the book's options.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PartnershipId, PersonId, StromData } from '../types.js';
import { buildLineages, selection } from '../lineage.js';
import { buildBookModel, lineageSpec, type BookSelectionSpec } from '../book-model.js';
import { autoBookTitle, defaultBookOptions } from '../book-options.js';
import { bookTitlePage, buildFamilyBook } from '../book.js';
import { findHouse } from '../houses.js';
import { HOUSE_NOW, houseTree } from './helpers/house-book-fixture.js';

const HOUSE: BookSelectionSpec = { kind: 'house', place: 'Bělokamen', house: 'čp. 16' };

/** The fixture with a daughter born at čp. 16 (and nothing else there) and a grandson born elsewhere. */
function tree(): StromData {
    const data = houseTree();
    data.persons['vlastimila' as PersonId] = {
        id: 'vlastimila' as PersonId, firstName: 'Vlastimila', lastName: 'Prouzalová', gender: 'female', isPlaceholder: false,
        birthPlace: 'Bělokamen', birthAddress: 'čp. 16', birthDate: '1880', deathPlace: 'Hvozdnice', deathDate: '1950',
        parentIds: ['hostivit', 'kunhuta'] as PersonId[], childIds: [], partnerships: [],
    };
    data.persons['radovan' as PersonId] = {
        id: 'radovan' as PersonId, firstName: 'Radovan', lastName: 'Prouzal', gender: 'male', isPlaceholder: false,
        birthPlace: 'Hvozdnice', birthDate: '1928', deathDate: '1990',
        parentIds: ['lubor', 'belomira'] as PersonId[], childIds: [], partnerships: [],
    };
    const u2 = data.partnerships['u2' as PartnershipId];
    u2.childIds = [...u2.childIds, 'vlastimila' as PersonId];
    data.persons['hostivit' as PersonId].childIds.push('vlastimila' as PersonId);
    data.persons['kunhuta' as PersonId].childIds.push('vlastimila' as PersonId);
    const u3 = data.partnerships['u3' as PartnershipId];
    u3.childIds = [...u3.childIds, 'radovan' as PersonId];
    data.persons['lubor' as PersonId].childIds.push('radovan' as PersonId);
    data.persons['belomira' as PersonId].childIds.push('radovan' as PersonId);
    return data;
}

describe('a book of a house: the selection', () => {
    it('the people of the house by birth (born, married, died or lived there), the spouses who married in, their families', () => {
        const data = tree();
        const sel = selection(data, lineageSpec(HOUSE, buildLineages(data)));
        expect(sel.memberIds).toEqual(['svatobor', 'radegunda', 'hostivit', 'kunhuta', 'vlastimila', 'lubor', 'vratislav', 'bohuslava']);
        // Bělomíra has no record at the house: a spouse beside Lubor.
        expect(sel.spouseIds).toEqual(['belomira']);
        expect(sel.familyIds).toEqual(['u1', 'u2', 'u3']);
        // A daughter born there is of the house; a grandson born elsewhere and Radegunda's father of another house are not.
        expect(sel.memberIds).toContain('vlastimila');
        expect(sel.personIds).not.toContain('radovan');
        expect(sel.personIds).not.toContain('drahobud');
    });

    it('a house without people (none of that number in the tree) selects nobody', () => {
        const data = tree();
        const sel = selection(data, { kind: 'house', place: 'Bělokamen', house: 'čp. 99' });
        expect(sel).toEqual({ memberIds: [], spouseIds: [], personIds: [], familyIds: [] });
        const model = buildBookModel(data, { kind: 'house', place: 'Bělokamen', house: 'čp. 99' });
        expect(model.chapters).toEqual([]);
        expect(model.personIds.size).toBe(0);
    });

    it('a number joined into the house finds the house', () => {
        const data = tree();
        data.persons['vlastimila' as PersonId].birthAddress = 'čp. 9';
        data.houses!['belokamen|16' as never] = { ...data.houses!['belokamen|16' as never], merged: ['belokamen|9' as never] };
        expect(findHouse(data, 'Bělokamen', 'čp. 9')?.id).toBe('belokamen|16');
        expect(selection(data, { kind: 'house', place: 'Bělokamen', house: 'čp. 9' }).memberIds).toContain('vlastimila');
    });

    it('the chapters: the families oldest first, generations counted from the oldest people of the house', () => {
        const data = tree();
        const model = buildBookModel(data, HOUSE);
        expect(model.chapters.map(c => [c.unionId, c.gen])).toEqual([['u1', 1], ['u2', 2], ['u3', 3]]);
        // The book names the people of the house and the children of its families.
        expect(model.personIds.has('vlastimila' as PersonId)).toBe(true);
        expect(model.personIds.has('radovan' as PersonId)).toBe(true);
        expect(model.smallRods).toEqual([]);
        expect(bookTitlePage(data, { ...defaultBookOptions('cs'), selection: HOUSE, privacy: 'full', houseRecent: false }, { now: HOUSE_NOW }).period).toBe('1820–2001');
    });
});

describe('a book of a house: the title and the options', () => {
    beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(HOUSE_NOW); });
    afterEach(() => { vi.useRealTimers(); });

    it('the title is the town, the house and its name after the farm', () => {
        const data = tree();
        expect(autoBookTitle(data, HOUSE, 'cs')).toBe('Bělokamen čp.\u00a016 · U Prouzalů');
        expect(autoBookTitle(data, { kind: 'house', place: 'Mlýnkovice', house: 'čp.\u00a03' }, 'en')).toBe('Mlýnkovice čp.\u00a03 · Na Mlýnku');
    });

    it('the selection goes through the options as data (the book window gives it back to the dialog)', () => {
        const opts = { ...defaultBookOptions('cs'), selection: HOUSE };
        const back = JSON.parse(JSON.stringify(opts)) as typeof opts;
        expect(back.selection).toEqual(HOUSE);
        const data = tree();
        expect(selection(data, lineageSpec(back.selection, buildLineages(data))).memberIds).toHaveLength(8);
    });

    it('the book: the people of the house; under privacy the house of the last ~100 years without its name after the farm', () => {
        const data = tree();
        const full = buildFamilyBook(data, { ...defaultBookOptions('cs'), selection: HOUSE, privacy: 'full' }, { dateLabel: 'x' });
        expect(full).toContain('Bělokamen čp.\u00a016 · U Prouzalů');
        expect(full).toContain('Svatobor');
        expect(full).toContain('Vlastimila');
        expect(full).not.toContain('Drahobud');
        const kept = buildFamilyBook(data, { ...defaultBookOptions('cs'), selection: HOUSE, privacy: 'initials' }, { dateLabel: 'x' });
        expect(kept).toContain('Bělokamen čp.\u00a016');
        expect(kept).not.toContain('U Prouzalů');
    });
});
