/**
 * The research's translation of a source's transcript travels in the source's
 * note as a section that opens with its label ("Translation:" in the research
 * tree's language). The app recognises it at display time only: the note stays
 * as stored and goes out again unchanged.
 */

import { describe, it, expect } from 'vitest';
import { splitSourceTranslation, sourceTranslation, SOURCE_TRANSLATION_LABELS } from '../source-translation.js';
import { parseGedcom, convertToStrom } from '../ged-parser.js';
import { exportToGedcom } from '../ged-exporter.js';
import { preparePersonPageData, buildPersonPageBody, PERSON_PAGE_ALL_GROUPS, PersonPageOptions } from '../person-page.js';
import { StromData, Person, PersonId } from '../types.js';

describe('recognising the translation section', () => {
    it.each(SOURCE_TRANSLATION_LABELS.map(l => [l]))('label %s at the start of the note', label => {
        expect(splitSourceTranslation(`${label}:\nVendula was born.`)).toEqual({ note: '', translation: 'Vendula was born.' });
    });

    it.each(SOURCE_TRANSLATION_LABELS.map(l => [l]))('label %s after another section', label => {
        const note = `Evidence: original, primary\n\n${label}:\nVendula was born.`;
        expect(splitSourceTranslation(note)).toEqual({ note: 'Evidence: original, primary', translation: 'Vendula was born.' });
    });

    it('knows exactly the four research labels', () => {
        expect([...SOURCE_TRANSLATION_LABELS]).toEqual(['Translation', 'Překlad', 'Übersetzung', 'Tłumaczenie']);
    });

    it('a label inside a paragraph is not a translation', () => {
        const note = 'Evidence: original, primary\nTranslation:\nnot a section';
        expect(splitSourceTranslation(note)).toEqual({ note });
        expect(sourceTranslation('See the Translation:\nbelow')).toBeUndefined();
    });

    it('the label must stand alone on its line', () => {
        expect(sourceTranslation('Translation: Vendula was born.')).toBeUndefined();
        expect(sourceTranslation('Translations:\nVendula')).toBeUndefined();
        expect(sourceTranslation(' Translation:\nVendula')).toBeUndefined();
        expect(sourceTranslation('translation:\nVendula')).toBeUndefined();
    });

    it('no note, no translation', () => {
        expect(splitSourceTranslation(undefined)).toEqual({ note: '' });
        expect(splitSourceTranslation('Evidence: original, primary')).toEqual({ note: 'Evidence: original, primary' });
        expect(sourceTranslation('Translation:\n\n')).toBeUndefined();
    });

    it('a multi-line translation keeps its lines and paragraphs to the end of the note', () => {
        const note = 'Head\n\nTranscript:\nРодилась Вендула\n\nTranslation:\nVendula was born\nin Kvapilov.\n\nGodparents: Ctibor Kvapil.\n';
        expect(splitSourceTranslation(note)).toEqual({
            note: 'Head\n\nTranscript:\nРодилась Вендула',
            translation: 'Vendula was born\nin Kvapilov.\n\nGodparents: Ctibor Kvapil.',
        });
    });

    it('CRLF line ends', () => {
        expect(splitSourceTranslation('Head\r\n\r\nPřeklad:\r\nVendula se narodila\r\nv Kvapilově.'))
            .toEqual({ note: 'Head', translation: 'Vendula se narodila\nv Kvapilově.' });
    });
});

const GED = [
    '0 HEAD', '1 GEDC', '2 VERS 5.5.1', '1 CHAR UTF-8',
    '0 @I1@ INDI', '1 NAME Vendula /Kvapilová/', '1 SEX F', '1 BIRT', '2 DATE 1 JAN 1880', '2 SOUR @S1@',
    '0 @S1@ SOUR', '1 TITL Метрическая книга рождений 1880',
    '1 TEXT Родилась Вендула', '2 CONT дочь Цтибора',
    '1 NOTE Evidence: original, primary',
    '1 NOTE Tłumaczenie:', '2 CONT Urodziła się Wendula,', '2 CONT córka Ctibora.',
    '0 TRLR', '',
].join('\n');

describe('the research GEDCOM', () => {
    const data = convertToStrom(parseGedcom(GED)).data;
    const src = Object.values(data.sources ?? {})[0]!;

    it('lands in the source note, recognised as the translation', () => {
        expect(src.note).toBe('Evidence: original, primary\n\nTłumaczenie:\nUrodziła się Wendula,\ncórka Ctibora.');
        expect(sourceTranslation(src.note)).toBe('Urodziła się Wendula,\ncórka Ctibora.');
        expect(src.transcript).toBe('Родилась Вендула\nдочь Цтибора');
    });

    it('round-trips unchanged (export → import → export)', () => {
        const once = exportToGedcom(data).content;
        const back = convertToStrom(parseGedcom(once)).data;
        expect(Object.values(back.sources ?? {})[0]!.note).toBe(src.note);
        expect(exportToGedcom(back).content).toBe(once);
    });
});

describe('the person page', () => {
    function tree(note?: string): StromData {
        const vendula: Person = {
            id: 'vendula' as PersonId, firstName: 'Vendula', lastName: 'Kvapilová', gender: 'female', isPlaceholder: false,
            parentIds: [], childIds: [], partnerships: [], birthDate: '1880-01-01', birthSourceIds: ['s1'],
        };
        return {
            persons: { [vendula.id]: vendula }, partnerships: {},
            sources: { s1: { id: 's1', title: 'Метрическая книга', transcript: 'Родилась Вендула', ...(note ? { note } : {}) } },
        } as StromData;
    }
    const page = (data: StromData, lang: PersonPageOptions['lang']) => {
        const op: PersonPageOptions = {
            personId: 'vendula' as PersonId, lang, mode: 'app', links: 'app', groups: { ...PERSON_PAGE_ALL_GROUPS },
            privacy: 'full', toggles: { history: true, childEvents: true }, research: true, now: new Date('2026-11-05T12:00:00Z'),
        };
        return buildPersonPageBody(preparePersonPageData(data, op), op);
    };

    it('shows the translation folded under the transcript', () => {
        const html = page(tree('Evidence: original\n\nTranslation:\nVendula was born.'), 'en');
        expect(html).toMatch(/<details class="pp-translation"><summary class="pp-kicker">Translation of the transcript<\/summary><p class="pp-transcript pp-translation-text">Vendula was born\.<\/p><\/details>/);
        expect(html.indexOf('Родилась Вендула')).toBeLessThan(html.indexOf('pp-translation'));
        expect(page(tree('Translation:\nVendula se narodila.'), 'cs')).toContain('Překlad přepisu');
    });

    it('without a translation the page is what it was', () => {
        expect(page(tree('Evidence: original'), 'en')).toBe(page(tree(), 'en'));
        expect(page(tree('Evidence: original'), 'en')).not.toContain('pp-translation');
    });
});
