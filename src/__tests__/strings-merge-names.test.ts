/**
 * One name per language for the same thing of the merge guide (doc
 * findings 3.32): unfinished merges are called alike in the toast of Save for
 * later, the Manage trees sections and the row; the date of an earlier merge
 * stands on its own in the sentence, whatever the language says it as
 * ("today 3:41 PM", "22.11.2026 15:41"), never after a preposition made for
 * a date alone.
 */
import { describe, it, expect } from 'vitest';
import { getStringsForLang } from '../strings.js';

const LANGS = ['cs', 'en', 'de', 'pl'] as const;

describe('unfinished merges: one name per language', () => {
    for (const lang of LANGS) {
        it(lang, () => {
            const s = getStringsForLang(lang);
            const name = s.treeManager.pendingSection;
            expect(s.merge.pendingMerges).toBe(name);
            expect(s.structure.pendingOrphans.startsWith(name)).toBe(true);
            // The row says one of them by the same word ("Unfinished merge: …").
            expect(s.structure.pendingRow('A', 'B').slice(0, 6)).toBe(name.slice(0, 6));
        });
    }
    it('en and de: Save for later points to the section by its name', () => {
        for (const lang of ['en', 'de'] as const) {
            const s = getStringsForLang(lang);
            expect(s.mergeWizard.savedLater('x', 2)).toContain(s.treeManager.pendingSection);
        }
    });
});

describe('an earlier merge: its date or day stands alone in the sentence', () => {
    const days = { cs: 'dnes 15:41', en: 'today 3:41 PM', de: 'heute 15:41', pl: 'dziś 15:41' } as const;
    for (const lang of LANGS) {
        it(lang, () => {
            const W = getStringsForLang(lang).mergeWizard;
            for (const text of [W.repeat(days[lang], 1, 3), W.repeatTree('Jilmovi', days[lang], 1, 3)]) {
                expect(text).toContain(`(${days[lang]})`);
                // Said once: the second mention is "that earlier merge".
                expect(text.split(days[lang]).length - 1).toBe(1);
            }
        });
    }
});
