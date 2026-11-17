/**
 * Table view (spec 084 §8): the Added column — in the Person group, offered
 * but not shown by default, the day in the UI language, "earlier" in italics
 * without a recorded date, and sorted down with "earlier" at the end.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildTableModel } from '../ui/table-view/table-model.js';
import { catalogColumns, defaultTypeState } from '../ui/table-view/table-state.js';
import { cellOf, cellPlainText, columnById, columnLabel } from '../ui/table-view/table-columns.js';
import { cellClasses } from '../ui/table-view/table-grid.js';
import { cellPasses, sortRows } from '../ui/table-view/table-filter.js';
import { setLanguage } from '../strings.js';
import type { PersonId, StromData } from '../types.js';

function model(lang: 'en' | 'cs' = 'en') {
    const person = (id: string, firstName: string, addedAt?: string) =>
        ({ id, firstName, lastName: 'Vorlenz', gender: 'male', isPlaceholder: false, partnerships: [], parentIds: [], childIds: [], ...(addedAt ? { addedAt } : {}) });
    const data = {
        persons: {
            a: person('a', 'Ambrož'),
            b: person('b', 'Bonifác', '2026-03-04T09:15:00'),
            c: person('c', 'Cyril', '2026-03-04T17:40:00'),
            d: person('d', 'Dalibor', '2025-12-31T23:00:00'),
        },
        partnerships: {},
    } as unknown as StromData;
    return buildTableModel(data, { rev: 1, homeId: 'a' as PersonId, lang, year: 2026, reliability: { researchTree: false, originFeature: false } });
}

describe('table: the Added column (spec 084 §8)', () => {
    afterAll(() => setLanguage('en'));
    beforeAll(() => setLanguage('en'));

    it('is a date column of the Person group, offered in the Columns panel, not shown by default', () => {
        const col = columnById('persons', 'added')!;
        expect(col).toBeDefined();
        expect(col.group).toBe('person');
        expect(col.kind).toBe('date');
        expect(columnLabel(col)).toBe('Added');
        expect(catalogColumns('persons').some(c => c.id === 'added')).toBe(true);
        expect(defaultTypeState('persons').columns).not.toContain('added');
    });

    it('shows the day in the UI language; without a date "earlier" in italics, an empty cell', () => {
        const m = model();
        const col = columnById('persons', 'added')!;
        const row = (id: string) => m.persons.find(r => r.id === id)!;
        const b = cellOf(m, row('b'), col);
        expect(b.empty).toBe(false);
        expect(cellPlainText(b)).not.toBe('');
        expect(cellPlainText(b)).toContain('2026');
        const a = cellOf(m, row('a'), col);
        expect(a.empty).toBe(true);
        expect(a.text).toBe('earlier');
        expect(cellClasses(a, col)).toContain('tv-cell--word');
        expect(cellClasses(b, col)).not.toContain('tv-cell--word');
        // A filter "Empty" finds the person without a date; a year range only the dated ones.
        expect(cellPasses(a, { col: 'added', kind: 'date', empty: true }, 'range')).toBe(true);
        expect(cellPasses(b, { col: 'added', kind: 'date', from: 2026, to: 2026 }, 'range')).toBe(true);
        expect(cellPasses(cellOf(m, row('d'), col), { col: 'added', kind: 'date', from: 2026, to: 2026 }, 'range')).toBe(false);
    });

    it('says "earlier" in Czech', () => {
        setLanguage('cs');
        const m = model('cs');
        const col = columnById('persons', 'added')!;
        expect(columnLabel(col)).toBe('Přidáno');
        expect(cellOf(m, m.persons.find(r => r.id === 'a')!, col).text).toBe('dříve');
        setLanguage('en');
    });

    it('sorted down: the newest first, within a day by the time, "earlier" at the end', () => {
        const m = model();
        const down = sortRows(m, 'persons', m.persons, [{ col: 'added', dir: 'desc' }]).map(r => r.id);
        expect(down).toEqual(['c', 'b', 'd', 'a']);
        const up = sortRows(m, 'persons', m.persons, [{ col: 'added', dir: 'asc' }]).map(r => r.id);
        expect(up).toEqual(['d', 'b', 'c', 'a']);
    });
});
