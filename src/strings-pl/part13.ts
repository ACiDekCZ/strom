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
        menu: 'Podarować rodowód…',
        title: 'Podarować rodowód',
        stepNames: ['Dla kogo', 'Kto w nim będzie', 'Dane żyjących', 'Co będzie w paczce', 'List przewodni', 'Podgląd i utworzenie'],
        step: (n: number, name: string) => `krok ${n} z 6: ${name}`,
        stepPhone: (n: number, name: string) => `Krok ${n} z 6 · ${name}`,
        fast: 'Od razu do podglądu ›',
        household: 'Plik jest dla tej osoby: obdarowany, partner i dzieci zawsze w całości.',
        allParts: 'Wybór dotyczy wszystkich części paczki: aplikacji, stron, księgi, wachlarza, GEDCOM i listu przewodniego.',
        create: 'Utwórz paczkę',
        last: (d: string) => `Ostatnio ${d} – te same ustawienia.`,
        restart: 'Zacznij od nowa z domyślnymi',
        guide: {
            stepsH: 'Kroki',
            stepDone: 'gotowe',
            back: 'Wstecz',
            next: 'Dalej',
            persons: (n: number) => plPl(n, 'osoba', 'osoby', 'osób'),
            generations: (n: number) => plPl(n, 'pokolenie', 'pokolenia', 'pokoleń'),
            living: (n: number) => plPl(n, 'żyjąca', 'żyjące', 'żyjących'),
            zip: (size: string) => `ZIP ok. ${size}`,
            forWhomH: 'Dla kogo będzie rodowód',
            mode: {
                single: { t: 'Jedna osoba', d: 'Paczka dla jednej osoby: jej przodkowie i rodziny wokół nich, jej domownicy.' },
                pair: { t: 'Para', d: 'Dwie osoby, jedna paczka: przodkowie obojga, list zwraca się do obojga.' },
                list: { t: 'Lista osób lub wybór', d: 'Dla każdej osoby własna paczka, ze wspólnymi ustawieniami.' },
            },
            listPhoneWhy: 'Tworzenie wielu paczek działa tylko na komputerze.',
            listPhoneNote: 'Lista osób lub wybór wymaga przewodnika na komputerze; na telefonie da się zrobić paczkę dla jednej osoby lub pary.',
            recipient: 'Obdarowany',
            recipients: 'Obdarowani',
            partnerFromTree: 'partner z drzewa',
            otherPerson: 'Inna osoba…',
            choosePerson: 'Wybór osoby…',
            secondMissing: 'Druga osoba nie jest jeszcze wybrana.',
            pairNote: 'Rodowód łączy przodków i rodziny obojga; list i powitanie zwracają się do obojga.',
            lonePerson: (name: string, female: boolean, change: string) =>
                `${name} nie ma w drzewie rodziców, partnera ani dzieci – rodowód byłby tylko ${female ? 'nią' : 'nim'}. Inna osoba przez „${change}”.`,
            signature: 'Podpis (widoczny w liście i po otwarciu aplikacji)',
            signatureShort: 'Podpis',
            defaultsH: 'Ustawienia domyślne',
            lastH: 'Ustawienia z ostatniego razu',
            lastMore: 'Kroki zaczną się od nich.',
            rows: { cut: 'W rodowodzie', living: 'Żyjący', parts: 'Paczka', letter: 'List przewodni' },
            cutDepth: [
                'przodkowie i ich partnerzy',
                'przodkowie i ich rodziny do kuzynów',
                'przodkowie i ich rodziny do kuzynów drugiego stopnia',
                'przodkowie i wszyscy ich krewni',
            ],
            cutBranches: (n: number) => `${nPl(n, 'gałąź', 'gałęzie', 'gałęzi')} ręcznie`,
            livingFull: (names: string, extra: number) => (extra > 0
                ? `${names} z rodziną i ${extra} ${plPl(extra, 'inna osoba', 'inne osoby', 'innych osób')} w całości` : `${names} z rodziną w całości`),
            others: { initials: 'pozostali inicjały i rok', anonymous: 'pozostali bez imion', minimal: 'pozostali tylko nazwisko' },
            livingAll: 'wszyscy w całości',
            livingNone: 'brak żyjących',
            parts: { letter: 'list', app: 'aplikacja', pages: 'strony', book: 'księga', fan: 'wachlarz', gedcom: 'GEDCOM' },
            withPhotos: 'ze zdjęciami',
            withoutPhotos: 'bez zdjęć',
            about: (size: string) => `ok. ${size}`,
            letterTemplate: 'szablon wiadomości',
            letterOwn: 'wiadomość z ostatniego razu',
            motif: { none: 'bez motywu', xmas: 'Boże Narodzenie' },
            today: 'dzisiejsza data',
            fastNote: 'Bez zmian można od razu przejść do podglądu; każdy krok da się zmienić także później.',
            phoneDefaults: 'Domyślnie: do kuzynów drugiego stopnia, żyjący skróceni, wszystko ze zdjęciami.',
            phoneLast: 'Ustawienia z ostatniego razu.',
            cutChanged: (n: number) => (n > 0
                ? `Od ostatniego razu w rodowodzie ${plPl(n, 'przybyła', 'przybyły', 'przybyło')} ${nPl(n, 'osoba', 'osoby', 'osób')} (liczby są już nowe). Wiadomość i datę warto sprawdzić.`
                : n < 0
                    ? `Od ostatniego razu w rodowodzie ${plPl(-n, 'ubyła', 'ubyły', 'ubyło')} ${nPl(-n, 'osoba', 'osoby', 'osób')} (liczby są już nowe). Wiadomość i datę warto sprawdzić.`
                    : 'Wiadomość i datę warto sprawdzić.'),
            statLivingOf: (n: number, total: number) => `${plPl(n, 'żyjąca', 'żyjące', 'żyjących')} z ${total} ${plPl(total, 'osoby', 'osób', 'osób')}`,
            statFull: 'w całości',
            statShort: { initials: 'inicjały i rok', anonymous: 'bez imion', minimal: 'tylko nazwisko' },
            statShortPhone: 'skróceni',
            livingH: 'Żyjący w rodowodzie',
            checkedFull: 'zaznaczone = w całości',
            recipientRel: (female: boolean) => (female ? 'obdarowana' : 'obdarowany'),
            fullWord: 'w całości',
            searchLiving: 'Wyszukiwanie wśród żyjących…',
            noMatch: 'Żadna żyjąca osoba nie pasuje.',
            noLiving: 'W rodowodzie nie ma żyjących osób – opcje ochrony nie mają zastosowania.',
            noLivingNote: 'Obowiązują tylko opcje dla zmarłych.',
            othersH: 'Pozostali żyjący',
            modeDesc: {
                full: 'Imiona, daty i dane poniżej tak, jak są w drzewie.',
                initials: 'Imię jako inicjały i tylko rok urodzenia; pozostałe dane, zdjęcia i notatki ukryte.',
                anonymous: '„Osoba żyjąca” zamiast imienia; dane, zdjęcia i notatki ukryte.',
                minimal: '„Osoba żyjąca” tylko z nazwiskiem; pozostałe dane, zdjęcia i notatki ukryte.',
            },
            sensitiveH: 'U żyjących pokazanych w całości',
            sensitive: {
                birthDates: 'Daty urodzenia', addresses: 'Adresy i miejsca zamieszkania', contacts: 'Kontakty (e-mail, telefon)',
                photos: 'Zdjęcia', notes: 'Notatki i historie', religion: 'Wyznanie', sources: 'Źródła z danymi osobowymi',
            },
            deadH: 'U zmarłych',
            dead: { causes: 'Przyczyny śmierci', notes: 'Notatki i historie', sources: 'Źródła i ich skany' },
        },
    },
};
