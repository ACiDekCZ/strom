/**
 * Showing the surname after marriage (spec 010, K1.3, K1.5): the shown name
 * picks the birth or the married surname by Settings → "Surname display",
 * with the birth surname as a quiet note by default; the family book's index
 * lists both; the surname-spellings dialog counts birth surnames only.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import {
    shownName, shownNameParts, shownNameFull, shownNameOrEmpty, nameHtml, surnameDisplay,
} from '../person-name.js';
import { SettingsManager } from '../settings.js';
import { buildFamilyBook } from '../book.js';
import { surnamesInTree, marriedSurnameHolders } from '../surnames.js';
import { fitBirthRow } from '../export-image.js';
import { setLanguage } from '../strings.js';
import { Person, PersonId, StromData, SurnameDisplay, toPersonId } from '../types.js';

function person(id: string, firstName: string, lastName: string, extra: Partial<Person> = {}): Person {
    return {
        id: toPersonId(id), firstName, lastName, gender: 'female', isPlaceholder: false,
        partnerships: [], parentIds: [], childIds: [], ...extra,
    };
}

const marie = person('m', 'Marie', 'Dvořáková', { marriedSurname: 'Nováková' });
const titled = person('t', 'Marie', 'Dvořáková', { marriedSurname: 'Nováková', titleBefore: 'Ing.', titleAfter: 'CSc.' });
const plain = person('p', 'Jana', 'Dvořáková');

afterEach(() => { vi.restoreAllMocks(); setLanguage('cs'); });

describe('the shown name and Settings → Surname display', () => {
    it('defaults to both, and the setting reads back what was saved (an unknown value falls back to both)', () => {
        vi.stubGlobal('localStorage', { setItem: () => {}, getItem: () => null, removeItem: () => {} });
        expect(SettingsManager.getSurnameDisplay()).toBe('both');
        SettingsManager.setSurnameDisplay('married');
        expect(surnameDisplay()).toBe('married');
        SettingsManager.setSurnameDisplay('nonsense' as SurnameDisplay);
        expect(surnameDisplay()).toBe('both');
        SettingsManager.setSurnameDisplay('both');
        vi.unstubAllGlobals();
    });

    const cases: [SurnameDisplay, string, string, string][] = [
        // display, shownName, shownNameFull, note
        ['birth', 'Marie Dvořáková', 'Marie Dvořáková', ''],
        ['both', 'Marie Nováková', 'Marie Nováková (roz. Dvořáková)', 'Dvořáková'],
        ['married', 'Marie Nováková', 'Marie Nováková', ''],
    ];
    for (const [display, name, full, note] of cases) {
        it(`${display}: with a married surname`, () => {
            setLanguage('cs');
            expect(shownName(marie, '', true, display)).toBe(name);
            expect(shownNameFull(marie, '', true, display)).toBe(full);
            expect(shownNameParts(marie, '', true, display).birthNote).toBe(note);
            expect(shownNameOrEmpty(marie, true, display)).toBe(name);
        });

        it(`${display}: without one the name is what it always was`, () => {
            expect(shownName(plain, '', true, display)).toBe('Jana Dvořáková');
            expect(shownNameFull(plain, '', true, display)).toBe('Jana Dvořáková');
            expect(shownNameParts(plain, '?', true, display)).toEqual({ given: 'Jana', surname: 'Dvořáková', birthNote: '', formerNote: '' });
            expect(nameHtml(plain, { display })).toBe('Jana Dvořáková');
        });

        it(`${display}: titles stay around the shown surname, never in the note`, () => {
            setLanguage('cs');
            const surname = display === 'birth' ? 'Dvořáková' : 'Nováková';
            expect(shownName(titled, '', true, display)).toBe(`Ing. Marie ${surname} CSc.`);
            expect(shownName(titled, '', false, display)).toBe(`Marie ${surname}`);
            expect(shownNameFull(titled, '', true, display))
                .toBe(display === 'both' ? 'Ing. Marie Nováková CSc. (roz. Dvořáková)' : `Ing. Marie ${surname} CSc.`);
        });
    }

    it('no note when the married surname is the birth one or there is no birth surname; a placeholder ignores it', () => {
        expect(shownNameFull(person('a', 'Eva', 'Nová', { marriedSurname: 'Nová' }), '', true, 'both')).toBe('Eva Nová');
        expect(shownNameFull(person('b', 'Eva', '', { marriedSurname: 'Nová' }), '', true, 'both')).toBe('Eva Nová');
        const ph = person('c', '', 'Dvořáková', { marriedSurname: 'Nováková', isPlaceholder: true });
        expect(shownName(ph, '?', true, 'married')).toBe('? Dvořáková');
    });

    it('nameHtml: the note as a quiet span, escaped, in each placement; the abbreviation follows the language', () => {
        setLanguage('cs');
        expect(nameHtml(marie, { display: 'both' }))
            .toBe('<span class="pn-main">Marie Nováková</span> <span class="pn-note">(roz. Dvořáková)</span>');
        expect(nameHtml(marie, { display: 'both', note: 'line' }))
            .toBe('<span class="pn-main">Marie Nováková</span><span class="pn-note pn-note--line">roz. Dvořáková</span>');
        expect(nameHtml(marie, { display: 'both', note: 'fit' })).toContain('<span class="pn-fit">');
        expect(nameHtml(marie, { display: 'both', note: 'none' })).toBe('Marie Nováková');
        const evil = person('x', '<b>', 'A&B', { marriedSurname: '"<i>' });
        expect(nameHtml(evil, { display: 'both' })).not.toMatch(/<b>|<i>/);
        setLanguage('en');
        expect(shownNameFull(marie, '', true, 'both')).toBe('Marie Nováková (née Dvořáková)');
        setLanguage('de');
        expect(shownNameFull(marie, '', true, 'both')).toBe('Marie Nováková (geb. Dvořáková)');
    });
});

describe('the family book index', () => {
    const data = (): StromData => ({
        persons: {
            m: person('m', 'Marie', 'Dvořáková', { marriedSurname: 'Nováková', birthDate: '1921', isDeceased: true }),
            j: person('j', 'Jan', 'Novák', { gender: 'male', birthDate: '1919', isDeceased: true }),
        } as StromData['persons'],
        partnerships: {},
    });

    it('lists the person under the birth surname with the married one, and a cross-reference under the married one', () => {
        const html = buildFamilyBook(data(), { lang: 'cs', privacyMode: 'full' });
        expect(html).toMatch(/Dvořáková, Marie<span class="book-muted">, provd. Nováková<\/span>/);
        expect(html).toContain('<div class="book-index-row book-index-see">Nováková, Marie → Dvořáková, Marie</div>');
        // Sorted under N: after "Novák, Jan".
        expect(html.indexOf('Novák, Jan')).toBeLessThan(html.indexOf('Nováková, Marie → Dvořáková'));
        expect(html.indexOf('Dvořáková, Marie')).toBeLessThan(html.indexOf('Novák, Jan'));
    });

    it('is independent of the setting, and unchanged without a married surname', () => {
        vi.spyOn(SettingsManager, 'getSurnameDisplay').mockReturnValue('birth');
        expect(buildFamilyBook(data(), { lang: 'cs', privacyMode: 'full' })).toContain('class="book-index-row book-index-see"');
        const without = data();
        delete without.persons['m' as PersonId].marriedSurname;
        const html = buildFamilyBook(without, { lang: 'cs', privacyMode: 'full' });
        expect(html).not.toContain('class="book-index-row book-index-see"');
        expect(html).not.toContain('po sňatku');
    });
});

describe('surname counts and married surnames', () => {
    const data: StromData = {
        persons: {
            m: person('m', 'Marie', 'Dvořáková', { marriedSurname: 'Nováková', birthDate: '1921' }),
            e: person('e', 'Eva', 'Malá', { marriedSurname: 'Nováková' }),
            j: person('j', 'Jan', 'Novák', { gender: 'male' }),
            k: person('k', 'Karel', 'Dvořák', { gender: 'male' }),
        } as StromData['persons'],
        partnerships: {},
    };

    it('counts stay with the birth surname: a married surname adds nothing', () => {
        const counts = Object.fromEntries(surnamesInTree(data).map(s => [s.surname, s.count]));
        expect(counts).toEqual({ 'Dvořáková': 1, 'Malá': 1, 'Novák': 1, 'Dvořák': 1 });
    });

    it('the holders of a married surname, found through every form of the surname', () => {
        expect(marriedSurnameHolders('Nováková', data).map(p => p.id)).toEqual(['e', 'm']);
        expect(marriedSurnameHolders('Novák', data).map(p => p.id)).toEqual(['e', 'm']);
        expect(marriedSurnameHolders('Dvořák', data)).toEqual([]);
    });
});

describe('the birth row in an exported image', () => {
    it('whole when it fits, shortened with at least four letters of the surname, else left out', () => {
        setLanguage('cs');
        expect(fitBirthRow('Dvořáková', 200, () => 60)).toBe('roz. Dvořáková');
        const w = (t: string): number => t.length * 6;
        const short = fitBirthRow('Vondráčková-Šťastná', 80, w);
        expect(short.endsWith('…')).toBe(true);
        expect(short.replace('roz. ', '').replace('…', '').length).toBeGreaterThanOrEqual(4);
        expect(fitBirthRow('Vondráčková', 40, w)).toBe('');
    });
});
