/**
 * Polish strings of "Give a family tree" (spec 093): the gift package's files and its steps,
 * the cover letter's templates and the cover page.
 */

import type { GiftTemplateFacts, StringsType } from '../strings.js';
import { nPl, plPl } from './helpers.js';

export const plPart13: Pick<StringsType, 'giftTree'> = {
    giftTree: {
        files: {
            zip: (name: string, year: number) => `Drzewo – ${name} – ${year}.zip`,
            folder: (name: string) => `Drzewo – ${name}`,
            start: 'Zacznij tutaj.html',
            app: 'Drzewo (aplikacja).html',
            pages: 'Strony rodziny',
            book: 'Księga rodu.html',
            fan: 'Wachlarz przodków',
            fanOf: (name: string) => `Wachlarz przodków – ${name}`,
            gedcomFolder: 'Dla innych programów',
            gedcom: 'Drzewo.ged',
            batch: (year: number) => `Drzewa ${year}.zip`,
        },
        steps: {
            cut: 'Obliczanie rodowodu i ochrona żyjących',
            app: 'Aplikacja z rodowodem',
            pages: 'Strony rodziny',
            book: 'Księga rodu',
            fan: 'Wachlarz przodków',
            gedcom: 'GEDCOM',
            zip: 'Zapis ZIP',
        },
        salutationToken: '[imię]',
        template: {
            none: (f: GiftTemplateFacts): string => {
                const d = f.oldest ? [f.oldest.when, f.oldest.place].filter(Boolean).join(', ') : '';
                const hi = f.couple ? 'Drodzy' : f.gender === 'female' ? 'Droga' : f.gender === 'male' ? 'Drogi' : 'Drogi/Droga';
                return `${hi} [imię],\n\n`
                    + `przesyłam kawałek naszej rodziny: ${f.ancestors ? `${f.couple ? 'waszych' : 'twoich'} przodków i rodziny wokół nich` : 'najbliższą rodzinę i rodziny wokół niej'}.`
                    + (f.oldest ? ` Najdalej sięga ${f.oldest.name}${d ? ` (${d})` : ''}.` : '')
                    + ` Razem ${nPl(f.persons, 'osoba', 'osoby', 'osób')}${f.years ? ` i ${nPl(f.years, 'rok', 'lata', 'lat')}` : ''}.\n\n`
                    + `Wszystko otwiera się w przeglądarce, niczego nie trzeba instalować. Gdyby ${f.couple ? 'wam' : 'ci'} coś przyszło do głowy, wystarczy napisać.`;
            },
            xmas: (f: GiftTemplateFacts): string => {
                const d = f.oldest ? [f.oldest.when, f.oldest.place].filter(Boolean).join(', ') : '';
                const hi = f.couple ? 'Drodzy' : f.gender === 'female' ? 'Droga' : f.gender === 'male' ? 'Drogi' : 'Drogi/Droga';
                return `${hi} [imię],\n\n`
                    + `na święta przesyłam kawałek naszej rodziny: ${f.ancestors ? `${f.couple ? 'waszych' : 'twoich'} przodków i rodziny wokół nich` : 'najbliższą rodzinę i rodziny wokół niej'}.`
                    + (f.oldest ? ` Najdalej sięga ${f.oldest.name}${d ? ` (${d})` : ''}.` : '')
                    + ` Razem ${nPl(f.persons, 'osoba', 'osoby', 'osób')}${f.years ? ` i ${nPl(f.years, 'rok', 'lata', 'lat')}` : ''}.\n\n`
                    + `Wszystko otwiera się w przeglądarce, niczego nie trzeba instalować. Gdyby ${f.couple ? 'wam' : 'ci'} coś przyszło do głowy, wystarczy napisać.\n\n`
                    + 'Wesołych Świąt!';
            },
        },
        cover: {
            kicker: 'Rodowód',
            kickerXmas: (year: number) => `Boże Narodzenie ${year} · Rodowód`,
            ancestorsTo: (year: number) => `przodkowie aż do roku ${year}`,
            persons: (n: number) => plPl(n, 'osoba', 'osoby', 'osób'),
            generations: (n: number) => plPl(n, 'pokolenie', 'pokolenia', 'pokoleń'),
            years: (n: number) => plPl(n, 'rok', 'lata', 'lat'),
            rods: (n: number) => plPl(n, 'ród', 'rody', 'rodów'),
            whatH: 'Co jest w paczce',
            whatLead: 'Wszystko otwiera się w przeglądarce, bez instalacji i bez internetu. Najwięcej pokazuje Drzewo (aplikacja).',
            printLead: (folder: string) => `Pliki w folderze „${folder}” (po rozpakowaniu ZIP).`,
            unzip: 'Jeśli linki się nie otwierają, paczka nie jest rozpakowana. W Windows: prawym przyciskiem na plik ZIP › Wyodrębnij wszystkie…, na Macu dwuklik; potem ponownie otworzyć Zacznij tutaj.',
            parts: {
                start: { t: 'Zacznij tutaj', f: 'Ta strona z odnośnikami do pozostałych części.', p: 'Ta strona z odnośnikami do pozostałych części.' },
                app: {
                    t: 'Drzewo (aplikacja)',
                    f: 'Cały rodowód do przeglądania: drzewo, oś czasu, mapa i wachlarz. Otwiera się w przeglądarce, bez instalacji i bez internetu.',
                    p: 'Cały rodowód do przeglądania. Otwiera się dwuklikiem w przeglądarce, bez instalacji i bez internetu.',
                },
                pages: {
                    t: 'Strony rodziny',
                    f: 'Rodzina jako połączone strony: każda osoba, jej rodzice, dzieci i miejsca. Wygodne także na telefonie.',
                    p: 'Połączone strony rodziny, także na telefonie.',
                },
                book: {
                    t: 'Księga rodu',
                    f: 'Rozdziały według rodzin z indeksem, gotowe do druku. PDF: w przeglądarce Drukuj › Zapisz jako PDF.',
                    p: 'Rozdziały według rodzin do druku. PDF: w przeglądarce Drukuj › Zapisz jako PDF.',
                },
                fan: { t: 'Wachlarz przodków', f: 'Wszyscy bezpośredni przodkowie na jednym obrazie, do druku albo jako plakat.', p: 'Bezpośredni przodkowie na jednym obrazie.' },
                gedcom: { t: 'Dla innych programów', f: 'Rodowód w formacie GEDCOM dla innych programów genealogicznych.', p: 'GEDCOM dla innych programów genealogicznych.' },
            },
            open: 'Otwórz ›',
            showFile: 'Pokaż plik ›',
            numbersH: 'Rodowód w liczbach',
            oldest: 'Najstarszy przodek',
            rodsK: 'Rody',
            places: 'Miejsca',
            journey: 'Droga rodziny',
            oldestRecord: 'Najstarszy zapis',
            about: 'około',
            chartH: 'Osoby według pokoleń',
            chartNote: (last: string) => `I = najstarsze, ${last} = najmłodsze`,
            created: (date: string) => `Utworzono ${date} w aplikacji Strom`,
            offline: 'wszystko działa bez internetu',
            shortened: 'u żyjących osób niektóre dane są skrócone',
        },
    },
};
