/**
 * The house's number kept to its marker (spec 030, designer's round 2,
 * question 18): houseLabel / houseTitle; the leaving sentence of the line's
 * timeline (question 48: "· then {town} No. 16", in the same town "· then
 * No. 16"); the round's texts in cs/en/de/pl (questions 2, 10, 12, 28, 30, 44).
 */

import { describe, it, expect } from 'vitest';
import { collectHouses, houseLabel, houseNamedTitle, houseTitle } from '../houses.js';
import { houseOutputs } from '../house-events.js';
import { getStringsForLang } from '../strings.js';
import type { StromData } from '../types.js';
import { HOUSE_NOW, houseTree } from './helpers/house-book-fixture.js';

const NB = ' ';

describe('houseLabel: the number on one line with the word before it', () => {
    it.each([
        ['čp. 16', `čp.${NB}16`],
        ['Haus Nr. 16', `Haus Nr.${NB}16`],
        ['House No. 3', `House No.${NB}3`],
        ['Kopřivná 12', `Kopřivná${NB}12`],
        ['č. p.  4a', `č. p.${NB}4a`],
        ['13/2', '13/2'],
        ['16', '16'],
        ['mlýn', 'mlýn'],
        [`čp.${NB}16`, `čp.${NB}16`],
    ])('%j → %j', (text, shown) => {
        expect(houseLabel(text)).toBe(shown);
    });

    it('the title and the named title keep the number to its marker; the town may wrap', () => {
        const h = { ref: { town: 'Horní Lhota nad Prouzalkou', house: '16' }, text: 'čp. 16', name: 'U Starého' };
        expect(houseTitle(h)).toBe(`Horní Lhota nad Prouzalkou čp.${NB}16`);
        expect(houseNamedTitle(h)).toBe(`Horní Lhota nad Prouzalkou čp.${NB}16 · U Starého`);
    });

    it('the house\'s own text (the data) is unchanged', () => {
        const houses = collectHouses(houseTree());
        expect(houses.find(h => h.id === 'belokamen|16')?.text).toBe('čp. 16');
    });
});

describe('the leaving sentence (question 48)', () => {
    const leftOf = (data: StromData) => houseOutputs(data, collectHouses(data), HOUSE_NOW).events.find(e => e.kind === 'left' && e.personId === 'radegunda');

    it('to another town: the town and the house', () => {
        expect(leftOf(houseTree())?.to).toBe(`Bělokamen čp.${NB}16`);
    });

    it('within the same town: the house alone', () => {
        const data = houseTree();
        for (const id of ['drahobud', 'radegunda'] as const) {
            const p = data.persons[id as never]!;
            if (p.birthPlace === 'Mlýnkovice') p.birthPlace = 'Bělokamen';
            if (p.deathPlace === 'Mlýnkovice') p.deathPlace = 'Bělokamen';
        }
        data.partnerships['u1' as never]!.startPlace = 'Bělokamen';
        expect(leftOf(data)?.to).toBe(`čp.${NB}16`);
    });

    it('the sentence in cs/en/de/pl', () => {
        const left = (lang: 'cs' | 'en' | 'de' | 'pl', sex: 'm' | 'f', to: string) =>
            getStringsForLang(lang).houses.integration.left('Radegunda', 'čp. 3', to, sex);
        expect(left('cs', 'f', 'Bělokamen čp. 16')).toBe('Radegunda odešla z domu čp. 3 · dál Bělokamen čp. 16');
        expect(left('cs', 'm', 'čp. 16')).toBe('Radegunda odešel z domu čp. 3 · dál čp. 16');
        expect(left('en', 'f', 'Bělokamen No. 16')).toBe('Radegunda left house čp. 3 · then Bělokamen No. 16');
        expect(left('de', 'f', 'Bělokamen Nr. 16')).toBe('Radegunda zog aus Haus čp. 3 aus · danach Bělokamen Nr. 16');
        expect(left('pl', 'f', 'Bělokamen nr 16')).toBe('Radegunda opuściła dom čp. 3 · potem Bělokamen nr 16');
        expect(left('pl', 'm', 'nr 16')).toBe('Radegunda opuścił dom čp. 3 · potem nr 16');
    });
});

describe('the round\'s texts (questions 2, 10, 12, 28, 30, 44)', () => {
    const S = (lang: 'cs' | 'en' | 'de' | 'pl') => getStringsForLang(lang);

    it('the town chip and its label (2)', () => {
        expect(['cs', 'en', 'de', 'pl'].map(l => S(l as 'cs').houses.townOnly('Bělokamen')))
            .toEqual(['Obec: Bělokamen', 'Town: Bělokamen', 'Ort: Bělokamen', 'Miejscowość: Bělokamen']);
        expect(['cs', 'en', 'de', 'pl'].map(l => S(l as 'cs').houses.townClear))
            .toEqual(['Zrušit omezení na obec', 'Remove the town filter', 'Ortsfilter aufheben', 'Usuń filtr miejscowości']);
    });

    it('the material dialog: the button with files and the sentence by number (10), the house name (12)', () => {
        expect(['cs', 'en', 'de', 'pl'].map(l => S(l as 'cs').houses.attachGoFiles))
            .toEqual(['Přiložit a pokračovat…', 'Attach and continue…', 'Anhängen und weiter…', 'Dołącz i kontynuuj…']);
        const files = (l: 'cs' | 'en' | 'de' | 'pl') => [1, 2, 5].map(n => S(l).houses.attachFiles(n));
        expect(files('cs')).toEqual([
            '1 soubor jde do výzkumu jako dávka domu.', '2 soubory jdou do výzkumu jako dávka domu.', '5 souborů jde do výzkumu jako dávka domu.']);
        expect(files('en')).toEqual([
            '1 file goes to the research as a house batch.', '2 files go to the research as a house batch.', '5 files go to the research as a house batch.']);
        expect(files('de')).toEqual([
            '1 Datei geht als Hausstapel an die Forschung.', '2 Dateien gehen als Hausstapel an die Forschung.', '5 Dateien gehen als Hausstapel an die Forschung.']);
        expect(files('pl')).toEqual([
            '1 plik trafi do badań jako partia domu.', '2 pliki trafią do badań jako partia domu.', '5 plików trafi do badań jako partia domu.']);
        expect(['cs', 'en', 'de', 'pl'].map(l => S(l as 'cs').houses.farmName))
            .toEqual(['Jméno po chalupě', 'House name', 'Hausname', 'Nazwa zwyczajowa domu']);
    });

    it('the place menu\'s target (28)', () => {
        expect(['cs', 'en', 'de', 'pl'].map(l => [S(l as 'cs').houses.familyHouses.pageLine, S(l as 'cs').houses.familyHouses.windowLine]))
            .toEqual([['stránka domu', 'okno Domy'], ['house page', 'Houses window'], ['Hausseite', 'Fenster Häuser'], ['strona domu', 'okno Domy']]);
    });

    it('the location under the house page\'s map (30)', () => {
        const pos = (l: 'cs' | 'en' | 'de' | 'pl') => {
            const m = S(l).houses.page.map;
            return [m.posManual, m.posConfirmed, m.posSure];
        };
        expect(pos('cs')).toEqual(['Poloha zadaná ručně', 'Poloha potvrzená', 'Poloha podle výzkumu · jistota vysoká']);
        expect(pos('en')).toEqual(['Location set by hand', 'Location confirmed', 'Location from the research · high certainty']);
        expect(pos('de')).toEqual(['Lage von Hand gesetzt', 'Lage bestätigt', 'Lage laut Forschung · hohe Sicherheit']);
        expect(pos('pl')).toEqual(['Położenie ustawione ręcznie', 'Położenie potwierdzone', 'Położenie według badań · wysoka pewność']);
    });

    it('the book\'s switch for the last 100 years (44)', () => {
        const sw = (l: 'cs' | 'en' | 'de' | 'pl') => [S(l).book.dlg.houseRecent, S(l).book.dlg.houseRecentHint];
        expect(sw('cs')).toEqual(['Posledních 100 let jen jménem',
            'Lidé z posledních zhruba 100 let jen jménem a rolí, bez dat; jejich události, citlivé události a poloha domu se neuvádějí.']);
        expect(sw('en')).toEqual(['Last 100 years by name only',
            'People from roughly the last 100 years appear by name and role only, without dates; their events, sensitive events and the house location are left out.']);
        expect(sw('de')).toEqual(['Letzte 100 Jahre nur mit Namen',
            'Personen aus etwa den letzten 100 Jahren nur mit Namen und Rolle, ohne Daten; ihre Ereignisse, sensible Ereignisse und die Lage des Hauses entfallen.']);
        expect(sw('pl')).toEqual(['Ostatnie 100 lat tylko z nazwiska',
            'Osoby z mniej więcej ostatnich 100 lat tylko z imienia, nazwiska i roli, bez dat; ich wydarzenia, wydarzenia wrażliwe i położenie domu są pomijane.']);
    });
});

describe('the Table\'s text filter finds a house typed with a plain space', () => {
    it('foldText reads a non-breaking space as a space', async () => {
        const { foldText } = await import('../ui/table-view/table-filter.js');
        expect(foldText(houseTitle({ ref: { town: 'Bělokamen', house: '16' }, text: 'čp. 16' }))).toContain(foldText('čp. 16'));
    });
});
