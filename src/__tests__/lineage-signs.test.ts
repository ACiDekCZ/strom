/**
 * Lineage markers outside the cards (spec 112 §3): the Timeline's sign before
 * the name (screen: the legend's element; poster: SVG in the P2 hex) and the
 * Table's Lineage column (values, order, filter, R4, R5, default hidden, the
 * sign only while the markers are on).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Gender, Person, PersonId, StromData } from '../types.js';
import { classifyBranches, type BranchSet } from '../branch-colors.js';
import { BRANCH_COLORS } from '../branch-marker-svg.js';
import { branchSignsHtml, branchSignsSvg, branchSignWidth, BRANCH_SIGN_SLOT } from '../branch-sign.js';
import { computeTimelineModel } from '../timeline.js';
import { buildTimelineSvg, buildTimelinePosterSvg, type TimelineBranchSigns } from '../timeline-chart.js';
import { buildTableModel, type TableModel } from '../ui/table-view/table-model.js';
import { cellOf, columnById, DEFAULT_VIEWS, lineageCell } from '../ui/table-view/table-columns.js';
import { columnValues, filterKindOf, sortRows } from '../ui/table-view/table-filter.js';
import { lineageHtml } from '../ui/table-view/table-grid.js';

// The Timeline runs the living to "now" and the table counts ages: a fixed clock.
beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-06-15T10:30:00Z'));
});
afterEach(() => { vi.useRealTimers(); });

/*
 * An invented family around Wendel: father Osric (his parents Aldric and
 * Ysmay), mother Liesl (her parents Bertolf and Gunild), a son Piet, a
 * sister Fenna (no marker, R3). Aldric is also Liesl's grandfather's line
 * in `both()` (a marriage of cousins, R4).
 */
function person(id: string, gender: Gender, parentIds: string[], birth: string): Person {
    return {
        id: id as PersonId, firstName: id, lastName: 'Varrow', gender, isPlaceholder: false,
        parentIds: parentIds as PersonId[], childIds: [], partnerships: [], birthDate: birth,
    };
}
function data(persons: Person[]): StromData {
    for (const p of persons) for (const pid of p.parentIds) persons.find(x => x.id === pid)?.childIds.push(p.id);
    return { persons: Object.fromEntries(persons.map(p => [p.id, p])) as StromData['persons'], partnerships: {} };
}
function family(motherGender: Gender = 'female'): StromData {
    return data([
        person('Aldric', 'male', [], '1880'), person('Ysmay', 'female', [], '1882'),
        person('Bertolf', 'male', [], '1884'), person('Gunild', 'female', [], '1886'),
        person('Osric', 'male', ['Aldric', 'Ysmay'], '1910'), person('Liesl', motherGender, ['Bertolf', 'Gunild'], '1912'),
        person('Wendel', 'male', ['Osric', 'Liesl'], '1940'), person('Fenna', 'female', ['Osric', 'Liesl'], '1942'),
        person('Piet', 'male', ['Wendel'], '1970'),
    ]);
}
/** Wendel's parents are cousins: Aldric is the grandfather of both. */
function both(): StromData {
    return data([
        person('Aldric', 'male', [], '1860'),
        person('Osric', 'male', ['Aldric'], '1885'), person('Hilde', 'female', ['Aldric'], '1888'),
        person('Liesl', 'female', ['Hilde'], '1912'),
        person('Wendel', 'male', ['Osric', 'Liesl'], '1940'),
    ]);
}

const FOCUS = 'Wendel' as PersonId;
const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const signsOf = (d: StromData, marker: TimelineBranchSigns['marker']): TimelineBranchSigns => {
    const { map, numbered } = classifyBranches(d, FOCUS);
    return { marker, numbered, lines: map as ReadonlyMap<string, BranchSet> };
};
/** The label HTML of one person's timeline row. */
function rowLabel(svg: string, id: string): string {
    const at = svg.indexOf(`data-person-id="${id}"`);
    return svg.slice(at, svg.indexOf('</foreignObject>', at));
}

describe('Timeline: the lineage sign before the name (screen)', () => {
    const d = family();
    const model = computeTimelineModel(d, Object.keys(d.persons), 2026);
    const base = { esc, width: 900, rowH: 30, labelW: 160, mode: 'screen' as const, focusId: FOCUS };

    it('draws the legend\'s sign in the chosen shape, a slot on every row (empty for the focus and a sister, R3)', () => {
        const svg = buildTimelineSvg(model, { ...base, branches: signsOf(d, 'tag') });
        expect(rowLabel(svg, 'Aldric')).toContain('<span class="branch-swatch branch-sign" data-line="paternal" data-shape="tag" aria-hidden="true">');
        expect(rowLabel(svg, 'Gunild')).toContain('data-line="maternal" data-shape="tag"');
        expect(rowLabel(svg, 'Piet')).toContain('data-line="descendant" data-shape="tag"');
        expect(rowLabel(svg, 'Aldric')).toContain('title="paternal line"');
        for (const id of ['Wendel', 'Fenna']) {
            expect(rowLabel(svg, id)).toContain('<span class="branch-sign-slot"></span>');
            expect(rowLabel(svg, id)).not.toContain('branch-swatch');
        }
        // The life bar keeps the sex's colour.
        expect(svg).not.toContain(BRANCH_COLORS.paternal);
    });

    it('draws nothing while the markers are off or no signs are given', () => {
        for (const svg of [buildTimelineSvg(model, { ...base, branches: signsOf(d, 'none') }), buildTimelineSvg(model, base)]) {
            expect(svg).not.toContain('branch-sign');
        }
    });

    it('gives a person on both sides both signs (R4) and numbers two same-gender parents\' lines (R5)', () => {
        const b = both();
        const svg = buildTimelineSvg(computeTimelineModel(b, Object.keys(b.persons), 2026), { ...base, branches: signsOf(b, 'arc') });
        const aldric = rowLabel(svg, 'Aldric');
        expect(aldric).toContain('data-line="paternal" data-shape="arc"');
        expect(aldric).toContain('data-line="maternal" data-shape="arc"');
        expect(aldric).toContain('title="paternal and maternal line"');

        const two = family('male');
        const svg2 = buildTimelineSvg(computeTimelineModel(two, Object.keys(two.persons), 2026), { ...base, branches: signsOf(two, 'tag') });
        expect(rowLabel(svg2, 'Bertolf')).toContain('class="branch-swatch branch-sign is-numbered" data-line="maternal"');
        expect(rowLabel(svg2, 'Bertolf')).toContain('title="second parent\'s line"');
    });
});

describe('Timeline poster: the sign in SVG', () => {
    const meta = { treeName: 'Varrow', viewLabel: 'Timeline', dateLabel: '1 Jan 2026' };

    it('draws each shape in the P2 hex before the name and moves the name right of it', () => {
        const d = family();
        const model = computeTimelineModel(d, Object.keys(d.persons), 2026);
        const plain = buildTimelinePosterSvg(model, { esc }, meta);
        expect(plain).not.toContain('branch-sign');
        expect(plain).toContain('<text x="4" ');

        const tag = buildTimelinePosterSvg(model, { esc, branches: signsOf(d, 'tag') }, meta);
        expect(tag).toMatch(/<g class="branch-sign" data-shape="tag" data-branch="paternal"><rect [^>]*fill="#234e8c"\/><text [^>]*>P<\/text><\/g>/);
        expect(tag).toContain(`<text x="${4 + BRANCH_SIGN_SLOT + 6}" `);

        const stripe = buildTimelinePosterSvg(model, { esc, branches: signsOf(d, 'stripe') }, meta);
        expect(stripe).toMatch(/data-shape="stripe" data-branch="maternal"[^>]*stroke="#d0679a"[^>]*stroke-dasharray="6 4"/);
        expect(stripe).toMatch(/data-shape="stripe" data-branch="descendant"[^>]*stroke="#8a6400"[^>]*stroke-dasharray="3 3"/);

        // The maternal corner is hatched: the image carries the pattern once.
        const corner = buildTimelinePosterSvg(model, { esc, branches: signsOf(d, 'corner') }, meta);
        expect(corner).toContain('<pattern id="branch-hatch"');
        expect(corner).toMatch(/data-shape="corner" data-branch="maternal" d="[^"]+" fill="url\(#branch-hatch\)"/);
        expect(corner).toMatch(/data-shape="corner" data-branch="descendant" [^>]*fill-rule="evenodd"/);

        const arc = buildTimelinePosterSvg(model, { esc, branches: signsOf(d, 'arc') }, meta);
        expect(arc).toMatch(/<path class="branch-sign" data-shape="arc" data-branch="paternal" d="[^"]+" fill="#234e8c"\/>/);
        expect(arc).not.toContain('<pattern');
    });

    it('lays two signs side by side and writes 1 and 2 on the tags of two same-gender parents', () => {
        expect(branchSignWidth(['paternal'], 'tag')).toBe(BRANCH_SIGN_SLOT);
        expect(branchSignWidth(['paternal', 'maternal'], 'tag')).toBe(29);
        const two = branchSignsSvg(['paternal', 'maternal'], 'tag', 4, 15, { paternal: '1', maternal: '2', descendant: 'D' });
        expect(two.match(/<g class="branch-sign"/g)).toHaveLength(2);
        expect(two).toContain('>1</text>');
        expect(two).toContain('>2</text>');
        const d = family('male');
        const svg = buildTimelinePosterSvg(computeTimelineModel(d, Object.keys(d.persons), 2026), { esc, branches: signsOf(d, 'tag') },
            { treeName: '', viewLabel: '', dateLabel: '' });
        expect(svg).toMatch(/data-branch="maternal"><rect [^>]*\/><text [^>]*>2<\/text>/);
    });
});

describe('Table: the Lineage column', () => {
    const model = (d: StromData, homeId: string | null = 'Wendel'): TableModel =>
        buildTableModel(d, { rev: 1, homeId: homeId as PersonId | null, lang: 'en', year: 2026 });
    const col = columnById('persons', 'lineage')!;
    const cell = (m: TableModel, id: string) => cellOf(m, m.personRows.get(id as PersonId)!, col);

    it('is offered in the Person group, computed, hidden by default and filtered by its values', () => {
        expect(col).toMatchObject({ group: 'person', label: 'lineage', computed: true, width: 130 });
        expect(DEFAULT_VIEWS.persons.columns).not.toContain('lineage');
        expect(filterKindOf(col)).toBe('values');
    });

    it('names the line relative to the home person; the focus, a sister and nobody without a home person stay empty', () => {
        const m = model(family());
        expect(cell(m, 'Ysmay')).toMatchObject({ text: 'Paternal', lineage: ['paternal'] });
        expect(cell(m, 'Liesl')).toMatchObject({ text: 'Maternal', lineage: ['maternal'] });
        expect(cell(m, 'Piet')).toMatchObject({ text: 'Descendant', lineage: ['descendant'] });
        expect(cell(m, 'Wendel').empty).toBe(true);
        expect(cell(m, 'Fenna').empty).toBe(true);
        expect(cell(model(family(), null), 'Osric').empty).toBe(true);
        expect(lineageCell(m.ctx, 'nobody' as PersonId).empty).toBe(true);
    });

    it('says both lines for a person on both sides (R4) and the parents\' numbers for two same-gender parents (R5)', () => {
        expect(cell(model(both()), 'Aldric')).toMatchObject({ text: 'Paternal and maternal', lineage: ['paternal', 'maternal'] });
        const m = model(family('male'));
        expect(cell(m, 'Osric')).toMatchObject({ text: 'First parent\'s line', lineageNumbered: true });
        expect(cell(m, 'Gunild')).toMatchObject({ text: 'Second parent\'s line', lineageNumbered: true });
        expect(cell(m, 'Piet').text).toBe('Descendant');
    });

    it('sorts paternal → maternal → descendant, the people without a line last; the filter offers the values in that order', () => {
        const m = model(family());
        const sorted = sortRows(m, 'persons', [...m.persons], [{ col: 'lineage', dir: 'asc' }]).map(r => cell(m, r.id).text);
        const firstEmpty = sorted.indexOf('');
        expect(sorted.slice(0, firstEmpty)).toEqual(['Paternal', 'Paternal', 'Paternal', 'Maternal', 'Maternal', 'Maternal', 'Descendant']);
        expect(sorted.slice(firstEmpty).every(t => t === '')).toBe(true);
        expect(columnValues(m, 'persons', col).map(v => v.label)).toEqual(['Paternal', 'Maternal', 'Descendant']);
        // Both lines (R4) between the paternal and the maternal ones.
        const bothKey = cell(model(both()), 'Aldric').sortKey as number;
        expect(bothKey).toBeGreaterThan(cell(m, 'Ysmay').sortKey as number);
        expect(bothKey).toBeLessThan(cell(m, 'Liesl').sortKey as number);
    });

    it('draws the sign in the chosen shape before the words, the words alone while the markers are off', () => {
        const m = model(family('male'));
        const v = cell(m, 'Gunild');
        expect(lineageHtml(v, '', 'corner')).toBe(
            '<span class="tv-lineage"><span class="tv-lineage-signs">'
            + '<span class="branch-swatch branch-sign is-numbered" data-line="maternal" data-shape="corner" aria-hidden="true"><i></i></span>'
            + '</span><span class="tv-cell-text">Second parent\'s line</span></span>');
        expect(lineageHtml(v, '', 'none')).toBe('<span class="tv-cell-text">Second parent\'s line</span>');
        expect(branchSignsHtml(['paternal', 'maternal'], 'stripe', false).match(/data-shape="stripe"/g)).toHaveLength(2);
    });
});
