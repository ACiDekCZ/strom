/**
 * The Table view's legend "Marks" says what the cells really show
 * (1110-doc-tabulka-znacky): reliability where its columns really are
 * (the groups Reliability and research, Marriage, Source), its sample as
 * the cell's word; "does not apply" with the cell's own name and look,
 * in four languages.
 */

import { describe, it, expect, afterAll } from 'vitest';
import * as S from '../strings.js';
import { legendHtml } from '../ui/table-view/table-bubble.js';
import { cellClasses, cellText } from '../ui/table-view/table-grid.js';
import { columnsOf, naCell } from '../ui/table-view/table-columns.js';

afterAll(() => S.setLanguage('en'));

describe('the legend of the Table view', () => {
    it('reliability: its columns stand only in the groups the legend names', () => {
        const groups = new Set((['persons', 'unions', 'events', 'sources'] as const)
            .flatMap(type => columnsOf(type).filter(c => c.kind === 'pill').map(c => `${type}:${c.group}`)));
        expect([...groups].sort()).toEqual(['events:source', 'persons:rel', 'unions:wed']);
    });

    for (const lang of ['en', 'cs', 'de', 'pl'] as const) {
        it(`${lang}: reliability names those groups; "does not apply" is the cell's own name`, () => {
            S.setLanguage(lang);
            const t = S.strings.table;
            for (const g of [t.group.rel, t.group.wed, t.group.source]) expect(t.legendText.reliability).toContain(g);
            expect(t.legendKind.na.toLocaleLowerCase(lang)).toBe(t.na.toLocaleLowerCase(lang));
        });
    }

    it('the samples look as the cells do: reliability\'s word, "–" of a cell that does not apply', () => {
        S.setLanguage('en');
        const html = legendHtml();
        expect(html).toContain(`<span class="tv-leg-sample tv-leg-computed" aria-hidden="true">${S.strings.reliability.human}</span>`);
        const col = columnsOf('persons').find(c => c.id === 'relD')!;
        const na = naCell('', true);
        expect(cellText(na)).toBe('–');
        expect(cellClasses(na, col)).toContain('tv-cell--na');
        expect(html).toContain('<span class="tv-leg-sample tv-cell--na" aria-hidden="true">–</span>');
    });
});
