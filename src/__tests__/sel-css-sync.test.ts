import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SEL_CSS, SEL_TOKENS_CSS, SEL_RULES_CSS, SEL_LIGHT_DECLS, SEL_DARK_DECLS } from '../ui/sel-css.js';
import { personPageFileCss, PERSON_PAGE_CSS } from '../person-page-css.js';
import { FAMILY_PAGES_CSS, FAMILY_PAGES_APP_CSS } from '../family-pages-css.js';
import { BOOK_CSS } from '../book-css.js';
import { STORY_COMPARE_CSS } from '../story-compare.js';

const INDEX = readFileSync(resolve(__dirname, '../../index.html'), 'utf8');

function indexBlock(): string {
    const start = INDEX.indexOf('/* sel:start */');
    const end = INDEX.indexOf('/* sel:end */');
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    return INDEX.slice(start + '/* sel:start */'.length, end);
}

describe('the selection indicator: one source', () => {
    it('index.html carries exactly the text of src/ui/sel-css.ts between its markers, once', () => {
        expect(indexBlock().trim()).toBe(SEL_CSS.trim());
        expect(INDEX.split('/* sel:start */').length).toBe(2);
    });

    it('the block stands at the end of the main stylesheet, after the components\' own rules', () => {
        const end = INDEX.indexOf('/* sel:end */');
        const close = INDEX.indexOf('</style>', end);
        expect(INDEX.slice(end + '/* sel:end */'.length, close).trim()).toBe('');
    });

    it('the saved pages carry the tokens and the rules; the window\'s injected CSS does not repeat them', () => {
        const file = personPageFileCss('');
        expect(file).toContain(SEL_LIGHT_DECLS);
        expect(file).toContain(SEL_RULES_CSS);
        // The family pages' file follows the system's dark scheme: the dark tokens there too.
        expect(FAMILY_PAGES_CSS).toContain(SEL_DARK_DECLS);
        // The book (always light) with the story comparison inside it.
        expect(BOOK_CSS).toContain(SEL_LIGHT_DECLS);
        expect(BOOK_CSS).toContain(SEL_RULES_CSS);
        expect(BOOK_CSS.indexOf(SEL_RULES_CSS)).toBeGreaterThan(BOOK_CSS.indexOf(STORY_COMPARE_CSS));
        // In the app the rules come from index.html; a second copy injected later would win over components.
        for (const css of [PERSON_PAGE_CSS, FAMILY_PAGES_APP_CSS, STORY_COMPARE_CSS]) {
            expect(css).not.toContain(SEL_RULES_CSS);
            expect(css).not.toContain(SEL_TOKENS_CSS);
        }
    });
});
