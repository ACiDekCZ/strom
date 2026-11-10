/**
 * The research's marks in the Table view (spec 073 §16.3): ≠ on the cell of
 * the fact a conflict is about (a couple's fact on its one union, else on
 * Partner), drawn before the value with its name, and the legend's block
 * Research only in a research tree. Invented data only.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setLanguage, strings } from '../strings.js';
import type { Partnership, PartnershipId, Person, PersonId, ResearchConflict } from '../types.js';
import { conflictCells, type ConflictCellScope } from '../ui/table-view/table-checks.js';
import { cellInner, conflictMarkHtml, researchMarkHtml, researchHtml } from '../ui/table-view/table-grid.js';
import { legendHtml } from '../ui/table-view/table-bubble.js';
import { columnById } from '../ui/table-view/table-columns.js';
import type { CellValue } from '../ui/table-view/table-model.js';

beforeAll(() => setLanguage('en'));
afterAll(() => setLanguage('en'));

const person = (over: Partial<Person> = {}): Person => ({
    id: 'p1' as PersonId, firstName: 'Ignác', lastName: 'Šťovík', gender: 'male', partnerships: [], parentIds: [], childIds: [], ...over,
} as unknown as Person);

const union = (id: string, start?: string, place?: string, end?: string): Partnership => ({
    id: id as PartnershipId, person1Id: 'p1' as PersonId, person2Id: `x${id}` as PersonId, childIds: [], status: 'married',
    ...(start ? { startDate: start } : {}), ...(place ? { startPlace: place } : {}), ...(end ? { endDate: end } : {}),
} as unknown as Partnership);

const conflict = (fact: string, values: string[], over: Partial<ResearchConflict> = {}): ResearchConflict => ({
    id: `X${fact}${values.join('')}`, fact, status: 'open', values: values.map(value => ({ value })), ...over,
});

/** The scope as the app reads it (person-research-ui conflictScope): years are dates, the rest places. */
const scope = (c: ResearchConflict): ConflictCellScope => (c.values.every(v => /^\D*\d{3,4}\D*$/.test(v.value)) ? 'date' : 'place');

const cellsOf = (p: Person, list: ResearchConflict[], unions: Partnership[] = []) =>
    conflictCells(p, list, unions, scope).map(c => (c.union ? `${c.col}@${c.union}` : c.col));

describe('conflictCells (§16.3)', () => {
    it('puts a person’s fact on its date or place cell by the scope', () => {
        const p = person({ birthDate: '1849', birthPlace: 'Pelyňkov' });
        expect(cellsOf(p, [conflict('BIRT', ['1849', '1850'])])).toEqual(['bDate']);
        expect(cellsOf(p, [conflict('BIRT', ['Pelyňkov', 'Rebarborov'])])).toEqual(['bPlace']);
        expect(conflictCells(p, [conflict('DEAT', ['1890, Pelyňkov', '1891'])], [], () => 'fact').map(c => c.col)).toEqual(['dDate', 'dPlace']);
    });

    it('puts the name, the titles and the sex on their cells; EVEN and unknown facts nowhere', () => {
        const p = person();
        expect(cellsOf(p, [conflict('NAME', ['Ignác', 'Ignaz']), conflict('NPFX', ['Ing.', 'MUDr.']), conflict('SEX', ['M', 'F'])]))
            .toEqual(['name', 'titles', 'gender']);
        expect(cellsOf(p, [conflict('EVEN', ['x', 'y']), conflict('_FOO', ['1', '2'])])).toEqual([]);
    });

    it('marks the birth’s cell too when it shows the baptism, and the death’s when it shows the burial', () => {
        const baptised = person({ events: [{ id: 'e1', type: 'baptism', date: '1849-03-02', place: 'Pelyňkov' }, { id: 'e2', type: 'burial', date: '1910' }] } as Partial<Person>);
        expect(cellsOf(baptised, [conflict('CHR', ['1849', '1848'])])).toEqual(['bapDate', 'bDate']);
        expect(cellsOf(baptised, [conflict('CHR', ['Pelyňkov', 'Lipová'])])).toEqual(['bapPlace', 'bPlace']);
        expect(cellsOf(baptised, [conflict('BURI', ['1910', '1911'])])).toEqual(['burDate', 'dDate']);
        const born = person({ birthDate: '1849', events: [{ id: 'e1', type: 'baptism', date: '1849' }] } as Partial<Person>);
        expect(cellsOf(born, [conflict('CHR', ['1849', '1848'])])).toEqual(['bapDate']);
    });

    it('puts a marriage on the one union it fits, else on Partner', () => {
        const p = person();
        const unions = [union('F1', '1871-05-02', 'Pelyňkov'), union('F2', '1880', 'Rebarborov')];
        // 16f: the values fit the first union only.
        expect(cellsOf(p, [conflict('MARR', ['1871', '1872'])], unions)).toEqual(['wDate@F1']);
        expect(cellsOf(p, [conflict('MARR', ['Rebarborov', 'Lipová'])], unions)).toEqual(['wPlace@F2']);
        // 16h: no union fits, or more than one.
        expect(cellsOf(p, [conflict('MARR', ['1865', '1866'])], unions)).toEqual(['partner']);
        expect(cellsOf(p, [conflict('MARR', ['1871', '1880'])], unions)).toEqual(['partner']);
        expect(cellsOf(p, [conflict('MARR', ['1871', '1872'])], [])).toEqual(['partner']);
        // A divorce reads the unions' ends.
        expect(cellsOf(p, [conflict('DIV', ['1890', '1891'])], [union('F1', '1871', '', '1890'), union('F2', '1880')])).toEqual(['divDate@F1']);
    });

    it('leaves out a decided conflict', () => {
        expect(cellsOf(person({ birthDate: '1849' }), [conflict('BIRT', ['1849', '1850'], { status: 'decided' })])).toEqual([]);
    });
});

describe('≠ on a cell (§16.3)', () => {
    const value = (text: string): CellValue => ({ text, sortKey: text, empty: false, na: false, computed: false, approx: false, uncertain: false } as CellValue);

    it('stands before the value, a finding’s mark after it, with the name of the conflict', () => {
        const col = columnById('persons', 'bDate')!;
        const label = strings.table.res.conflictAria('1890', 'birth');
        expect(label).toBe('1890, sources disagree: birth');
        const html = cellInner(value('1890'), col, { severity: 'error', label: 'Death before birth' }, '', { label });
        const conf = html.indexOf('tv-conf');
        const text = html.indexOf('tv-cell-text');
        const mark = html.indexOf('tv-mark--error');
        expect(conf).toBeGreaterThan(-1);
        expect(conf).toBeLessThan(text);
        expect(text).toBeLessThan(mark);
        expect(html).toContain('aria-label="1890, sources disagree: birth"');
        expect(conflictMarkHtml({ label })).toMatch(/^<button type="button" class="tv-rmark tv-rmark--conf tv-conf" tabindex="-1"/);
        // No conflict: the cell as before.
        expect(cellInner(value('1890'), col)).not.toContain('tv-conf');
    });

    it('says only the conflict when the cell is empty', () => {
        expect(strings.table.res.conflictAria('', 'marriage')).toBe('Sources disagree: marriage');
    });

    it('draws the research marks: rimmed glyphs, the arc in step, ✓', () => {
        expect(researchMarkHtml('wait')).toBe('<span class="tv-rmark tv-rmark--wait" aria-hidden="true">!</span>');
        expect(researchMarkHtml('ext')).toContain('tv-rmark--ext');
        expect(researchMarkHtml('agent')).toMatch(/class="tv-rmark tv-rmark--agent" aria-hidden="true" style="animation-delay:-\d+ms"><\/span>$/);
        expect(researchMarkHtml('done')).toContain('>✓<');
        expect(researchHtml({ signal: 'q', parts: [], export: '' })).toContain('tv-rmark--q');
    });
});

describe('the legend (§1.5, §16.3, 16i)', () => {
    const rows = (html: string) => (html.match(/class="tv-leg-row[ "]/g) ?? []).length;

    it('is as before without research', () => {
        const html = legendHtml();
        expect(rows(html)).toBe(9);
        expect(html).not.toContain('tv-leg-row--res');
        expect(html).not.toContain(strings.table.res.legendNote);
    });

    it('ends with the block Research in a research tree', () => {
        const html = legendHtml('full');
        expect(rows(html)).toBe(15);
        const block = html.indexOf(`<div class="tv-leg-head">${strings.table.res.block}</div>`);
        expect(block).toBeGreaterThan(html.lastIndexOf(strings.table.legendText.na));
        for (const m of ['wait', 'ext', 'conf', 'q', 'agent', 'done']) expect(html).toContain(`tv-rmark--${m}`);
        expect(html).toContain(strings.table.res.legendText.conf);
        expect(html.trimEnd().endsWith(`<div class="tv-leg-note">${strings.table.res.legendNote}</div>`)).toBe(true);
    });

    it('has only the marks from the data in an archive or a read-only copy', () => {
        const html = legendHtml('data');
        expect(rows(html)).toBe(11);
        expect(html).not.toContain('tv-rmark--wait');
        expect(html).not.toContain('tv-rmark--agent');
        expect(html).toContain('tv-rmark--conf');
        expect(html).toContain('tv-rmark--q');
    });

    it('shows reliability as its cell does: the step’s word', () => {
        const html = legendHtml();
        expect(html).toContain(`<span class="tv-leg-sample tv-leg-computed" aria-hidden="true">${strings.reliability.human}</span>`);
        expect(html).not.toContain('tv-leg-pill');
    });
});
