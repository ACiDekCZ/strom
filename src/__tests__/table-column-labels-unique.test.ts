/**
 * Every table's column names are distinct in every language: the Columns
 * panel and the header menu name a column by its label alone, so two columns
 * named alike ("Linie" for the Person group's Lineage and the Research
 * group's line) read as the same one.
 */

import { describe, it, expect } from 'vitest';
import { getStringsForLang } from '../strings.js';
import { columnsOf } from '../ui/table-view/table-columns.js';

const LANGS = ['en', 'cs', 'de', 'pl'] as const;
const TYPES = ['persons', 'unions', 'events', 'sources'] as const;

describe('table column labels', () => {
    for (const lang of LANGS) {
        for (const type of TYPES) {
            it(`${type} in ${lang}: no two columns share a name`, () => {
                const col = getStringsForLang(lang).table.col;
                const seen = new Map<string, string>();
                const dups: string[] = [];
                for (const c of columnsOf(type)) {
                    const text = col[c.label].trim().toLocaleLowerCase(lang);
                    const prev = seen.get(text);
                    if (prev && prev !== c.label) dups.push(`${prev} / ${c.label}: ${col[c.label]}`);
                    seen.set(text, c.label);
                }
                expect(dups).toEqual([]);
            });
        }
    }

    it('the research line is named apart from the Lineage column', () => {
        const names = { cs: 'Linie výzkumu', de: 'Forschungslinie', pl: 'Linia badania', en: 'Line' };
        for (const lang of LANGS) expect(getStringsForLang(lang).table.col.rLine, lang).toBe(names[lang]);
    });
});
