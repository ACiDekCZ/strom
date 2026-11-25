/**
 * Polish strings of "Give a family tree" (spec 093): the gift package's files and its steps.
 */

import type { StringsType } from '../strings.js';

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
    },
};
