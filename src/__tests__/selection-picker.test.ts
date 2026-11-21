/**
 * The choice of the window's selection (spec 098 §2, 2a–2e): the sections in
 * the artboard's order, the empty states, the research lines only in a tree
 * with directions, the footer by whether lists can change, the block of the
 * chosen ancestors with its generations; the search over the sections
 * (selectionPickFilter) and the generations' stepper. Every name is invented.
 */

import { describe, expect, it } from 'vitest';
import {
    SelectionPickRow, SelectionPickerMarkup, SelectionPickRowInfo, selectionFoundRowsHtml, selectionIcon, selectionPickFilter, selectionPickerHtml,
} from '../rod-picker.js';
import { strings, setLanguage } from '../strings.js';
import { stepGenerations } from '../ui/selection-picker-ui.js';

const s = strings.selection;
const texts: SelectionPickerMarkup['texts'] = {
    button: s.button, pickLabel: s.pickLabel, search: s.search, none: s.none, noneSub: s.noneSub,
    secRods: s.secRods, secPerson: s.secPerson, secPersons: s.secPersons, secLines: s.secLines, secLists: s.secLists,
    otherPerson: s.otherPerson, current: s.current, person: s.person, changePerson: s.changePerson,
    generations: s.generations, genAll: s.genAll, noLists: s.noLists, noMatch: s.noMatch, saveList: s.saveList, manage: s.manage,
    other: 'Other families', members: (n: number) => `${n} people`, fewer: 'Fewer generations', more: 'More generations',
};

const row = (sel: string, label: string, extra: Partial<SelectionPickRow> = {}): SelectionPickRow => ({
    sel, label, count: 3, icon: selectionIcon('ancestors'), ...extra,
});

function markup(over: Partial<SelectionPickerMarkup> = {}): SelectionPickerMarkup {
    return {
        label: null, current: '', treeCount: 40,
        rods: {
            items: [
                { id: 'tree', label: 'Whole tree', from: null, to: null, members: 40, forms: [] },
                { id: 'r1' as never, label: 'Brumlák', from: 1700, to: 1900, members: 12, forms: ['brumlak'] },
                { id: 'other', label: 'Other families', from: null, to: null, members: 3, forms: [] },
            ],
            small: [{ id: 'r2' as never, label: 'Trnkavec', from: 1800, to: 1820, members: 2, forms: [] }],
            lo: 1650, hi: 2030,
        },
        focus: [row('anc:p1', 'Ancestors: Bořivoj', { sub: s.focusSub }), row('des:p1', 'Descendants: Bořivoj', { sub: s.focusSub })],
        lines: [],
        lists: [row('list:l1', 'Emigrants', { q: 'emigrants', sub: 'Fixed' })],
        block: null, canSave: false, texts, ...over,
    };
}

const heads = (html: string): string[] => [...html.matchAll(/class="sp-selpick-sh" data-sec="(\w+)"/g)].map(m => m[1]);
const sels = (html: string): string[] => [...html.matchAll(/ data-sel="([^"]+)"/g)].map(m => m[1]);

describe('selectionPickerHtml (§2, 2a)', () => {
    it('the sections in the artboard\'s order: none, lines, people, ancestors and descendants, lists', () => {
        const html = selectionPickerHtml(markup());
        expect(html).toContain('class="sp-rodpick sp-selpick"');
        expect(html.indexOf('sp-rodpick-q')).toBeLessThan(html.indexOf('sp-rodpick-list'));
        expect(heads(html)).toEqual(['rods', 'persons', 'focus', 'lists']);
        expect(sels(html)).toEqual(['none', 'rod:r1', 'rod:r2', 'anc:p1', 'des:p1', 'list:l1']);
        // "Another person…" in the head of Ancestors and descendants; the People head waits for a query.
        expect(html).toMatch(/data-sec="focus" role="presentation"><span>Ancestors and descendants<\/span><button type="button" class="sp-selpick-other">Another person…<\/button>/);
        expect(html).toMatch(/data-sec="persons" role="presentation" hidden>/);
        // Nothing chosen: "No selection" is the current row, the button says "Selection".
        expect(html).toMatch(/<li class="sp-rodpick-tree sel-opt" data-sel-form="row" data-sel="none" aria-current="true">/);
        expect(html).toContain('<span class="sp-rodpick-v">Selection</span>');
    });

    it('research lines only in a tree with directions, after Ancestors and descendants', () => {
        expect(heads(selectionPickerHtml(markup()))).not.toContain('lines');
        const html = selectionPickerHtml(markup({ lines: [row('line:d1', 'Moravian branch', { q: 'moravian branch', sub: s.lineSub })] }));
        expect(heads(html)).toEqual(['rods', 'persons', 'focus', 'lines', 'lists']);
    });

    it('no line worth choosing: no section Family lines; no lists: the section says so', () => {
        const html = selectionPickerHtml(markup({ rods: null, lists: [] }));
        expect(heads(html)).toEqual(['persons', 'focus', 'lists']);
        expect(html).toContain(`data-sec="lists" data-none="${s.noMatch.lists}" data-empty="${s.noLists}">${s.noLists}</li>`);
    });

    it('the footer: "Save the selection as a list…" only when offered, "Lists of people…" always', () => {
        const without = selectionPickerHtml(markup());
        expect(without).not.toContain('sp-selpick-save');
        expect(without).toContain(`class="sp-rodpick-savebtn sp-selpick-manage">${s.manage}`);
        const withSave = selectionPickerHtml(markup({ canSave: true }));
        expect(withSave).toContain(`class="sp-rodpick-savebtn sp-selpick-save">${s.saveList}`);
        expect(withSave.indexOf('sp-selpick-save')).toBeLessThan(withSave.indexOf('sp-selpick-manage'));
    });

    it('a chosen selection: its row current, the button with prefix and name', () => {
        const html = selectionPickerHtml(markup({ current: 'list:l1', label: { prefix: 'List:', name: 'Emigrants' }, lists: [row('list:l1', 'Emigrants', { q: 'emigrants', current: true })] }));
        expect(html).toMatch(/data-sel="list:l1" data-q="emigrants" aria-current="true">/);
        expect(html).toContain('<span class="sp-rodpick-pfx">List: </span><b>Emigrants</b>');
        expect(html).not.toMatch(/data-sel="none" aria-current/);
    });

    it('chosen ancestors: the block on top with the person, "Change…" and the generations', () => {
        const all = selectionPickerHtml(markup({ block: { title: 'Ancestors: Bořivoj', count: 7, person: 'Bořivoj Brumlák' } }));
        expect(all.indexOf('sp-selpick-cur')).toBeLessThan(all.indexOf('sp-rodpick-list'));
        expect(all).toContain('Person: <b>Bořivoj Brumlák</b>');
        expect(all).toContain('class="sp-selpick-change">Change…');
        expect(all).toMatch(/data-gen="-1" aria-label="Fewer generations">−/);
        expect(all).toContain('<span class="depth-stepper-value" aria-live="polite">all</span>');
        expect(all).toMatch(/data-gen="1" aria-label="More generations" disabled>/);
        const one = selectionPickerHtml(markup({ block: { title: 'Ancestors: Bořivoj', count: 2, person: 'Bořivoj Brumlák', generations: 1 } }));
        expect(one).toMatch(/data-gen="-1" aria-label="Fewer generations" disabled>/);
        expect(one).toContain('aria-live="polite">1</span>');
        expect(selectionPickerHtml(markup())).not.toContain('sp-selpick-cur');
    });

    it('found people go under People, another person\'s rows under Ancestors and descendants', () => {
        const rows = [row('anc:p9', 'Ancestors: Vojmír'), row('des:p9', 'Descendants: Vojmír')];
        expect(selectionFoundRowsHtml(rows)).toMatch(/sp-selpick-found" data-sel-form="row" data-sec="persons" data-found="" data-sel="anc:p9">/);
        const focus = selectionFoundRowsHtml(rows, 'focus');
        expect(focus).toContain('data-sec="focus" data-sel="des:p9"');
        expect(focus).not.toContain('data-found');
    });

    it('a count as the language writes it (thousands, spec 098 §12)', () => {
        const big = [{ ...row('anc:p9', 'Ancestors: Vojmír'), count: 12400 }];
        try {
            setLanguage('en');
            expect(selectionFoundRowsHtml(big)).toContain('<span class="sp-rodpick-c">12,400</span>');
            setLanguage('de');
            expect(selectionFoundRowsHtml(big)).toContain('<span class="sp-rodpick-c">12.400</span>');
            setLanguage('cs');
            expect(selectionFoundRowsHtml(big)).toContain(`<span class="sp-rodpick-c">${(12400).toLocaleString('cs-CZ')}</span>`);
            expect(strings.map.scopeSelNamed('Letters', 12400)).toBe(`Letters · ${(12400).toLocaleString('cs-CZ')}`);
        } finally {
            setLanguage('en');
        }
    });
});

describe('selectionPickFilter (§2, 2d)', () => {
    const rows: SelectionPickRowInfo[] = [
        { role: 'tree', sec: '' },
        { role: 'head', sec: 'rods' },
        { role: 'row', sec: 'rods', q: 'brumlak' },
        { role: 'other', sec: 'rods' },
        { role: 'small', sec: 'rods', q: 'trnkavec' },
        { role: 'none', sec: 'rods' },
        { role: 'head', sec: 'persons' },
        { role: 'none', sec: 'persons' },
        { role: 'head', sec: 'focus' },
        { role: 'row', sec: 'focus' },
        { role: 'head', sec: 'lists' },
        { role: 'row', sec: 'lists', q: 'emigrants' },
        { role: 'none', sec: 'lists' },
    ];
    const shown = (out: ReturnType<typeof selectionPickFilter>): number[] => out.flatMap((r, i) => (r.hidden ? [] : [i]));

    it('without a query: every section, no People, the small lines folded', () => {
        const out = selectionPickFilter(rows, '', false, false);
        expect(shown(out)).toEqual([0, 1, 2, 3, 8, 9, 10, 11]);
        expect(shown(selectionPickFilter(rows, '', true, false))).toContain(4);
    });

    it('a query: No selection and the person in focus step aside, a section without a hit says so', () => {
        const out = selectionPickFilter(rows, 'emig', false, false);
        expect(shown(out)).toEqual([1, 5, 10, 11]);
        expect(out[5].text).toBe('none');
    });

    it('a small line found: "Other families" stays with it', () => {
        expect(shown(selectionPickFilter(rows, 'trnk', false, false))).toEqual([1, 3, 4, 10, 12]);
    });

    it('people searched: the People section with its found rows, or its sentence without', () => {
        const found: SelectionPickRowInfo[] = [...rows.slice(0, 7), { role: 'found', sec: 'persons' }, { role: 'found', sec: 'persons' }, ...rows.slice(7)];
        const out = selectionPickFilter(found, 'bori', false, true);
        expect(out[6].hidden).toBe(false);
        expect(out[7].hidden).toBe(false);
        expect(out[9].hidden).toBe(true);
        const none = selectionPickFilter(rows, 'xyz', false, true);
        expect(none[6].hidden).toBe(false);
        expect(none[7]).toEqual({ hidden: false, text: 'none' });
    });
});

describe('the generations\' stepper', () => {
    it('− from all to ten and down to one, + up to ten and then all', () => {
        expect(stepGenerations(undefined, -1)).toBe(10);
        expect(stepGenerations(3, -1)).toBe(2);
        expect(stepGenerations(1, -1)).toBe(1);
        expect(stepGenerations(9, 1)).toBe(10);
        expect(stepGenerations(10, 1)).toBeUndefined();
        expect(stepGenerations(undefined, 1)).toBeUndefined();
    });
});
