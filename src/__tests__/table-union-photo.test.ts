/**
 * Table › Unions, the couple's photo (spec 107 §8): the Photo column (hidden
 * to start with), "yes" in an export, the rows with a photo first in either
 * direction, the filter "with photo" / "without photo" and a cell's Only /
 * Without. Invented data.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import type { PersonId, StromData } from '../types.js';
import { setLanguage } from '../strings.js';
import { buildTableModel, type TableModel, type TableRow } from '../ui/table-view/table-model.js';
import { cellOf, columnById, DEFAULT_VIEWS } from '../ui/table-view/table-columns.js';
import { cellPasses, columnItemLabel, filterKindOf, filterRows, sortRows } from '../ui/table-view/table-filter.js';
import { exportText } from '../ui/table-view/table-export.js';
import { cellChoices } from '../ui/table-view/table-cell.js';
import type { GridLine } from '../ui/table-view/table-subrows.js';

const PHOTO = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP8=';

function tree(): StromData {
    const person = (id: string, firstName: string, gender: 'male' | 'female', partnerships: string[]) =>
        ({ id, firstName, lastName: 'Quellmayer', gender, isPlaceholder: false, partnerships, parentIds: [], childIds: [] });
    return {
        persons: {
            o: person('o', 'Oskar', 'male', ['u1']), i: person('i', 'Ilsa', 'female', ['u1']),
            b: person('b', 'Bertold', 'male', ['u2']), w: person('w', 'Wendelin', 'female', ['u2']),
            k: person('k', 'Kasimir', 'male', ['u3']), z: person('z', 'Zenzi', 'female', ['u3']),
        },
        partnerships: {
            u1: { id: 'u1', person1Id: 'o', person2Id: 'i', childIds: [], status: 'married', startDate: '1924', photo: PHOTO },
            u2: { id: 'u2', person1Id: 'b', person2Id: 'w', childIds: [], status: 'married', startDate: '1910' },
            u3: { id: 'u3', person1Id: 'k', person2Id: 'z', childIds: [], status: 'married', startDate: '1930', photo: PHOTO },
        },
    } as unknown as StromData;
}

const build = (): TableModel =>
    buildTableModel(tree(), { rev: 1, homeId: 'o' as PersonId, lang: 'en', year: 2026, reliability: { researchTree: false, originFeature: false } });
const col = () => columnById('unions', 'uPhoto')!;
const ids = (rows: readonly TableRow[]) => rows.map(r => r.id);

beforeAll(() => setLanguage('en'));

describe('the Photo column of Unions (spec 107 §8)', () => {
    it('is a picture column of the union extras, not shown to start with', () => {
        const c = col();
        expect(c.kind).toBe('thumb');
        expect(c.group).toBe('uextra');
        expect(c.width).toBe(64);
        expect(DEFAULT_VIEWS.unions.columns).not.toContain('uPhoto');
    });

    it('carries the photo for the grid and "yes" for a copy and an export; no photo is an empty cell', () => {
        const m = build();
        const withPhoto = cellOf(m, m.unionRows.get('u1' as never)!, col());
        expect(withPhoto.thumb).toBe(PHOTO);
        expect(exportText(withPhoto)).toBe('yes');
        const without = cellOf(m, m.unionRows.get('u2' as never)!, col());
        expect(without.empty).toBe(true);
        expect(without.thumb).toBeUndefined();
        expect(exportText(without)).toBe('');
    });

    it('sorts the unions with a photo first in both directions', () => {
        const m = build();
        const asc = sortRows(m, 'unions', m.unions, [{ col: 'uPhoto', dir: 'asc' }, { col: 'wDate', dir: 'asc' }]);
        expect(ids(asc)).toEqual(['u1', 'u3', 'u2']);
        const desc = sortRows(m, 'unions', m.unions, [{ col: 'uPhoto', dir: 'desc' }, { col: 'wDate', dir: 'asc' }]);
        expect(ids(desc)[2]).toBe('u2');
    });

    it('filters with photo / without photo, labelled so', () => {
        const m = build();
        const c = col();
        expect(filterKindOf(c)).toBe('presence');
        const run = (item: Parameters<typeof cellPasses>[1]) =>
            ids(filterRows(m, 'unions', m.unions, { op: 'and', items: [item] }).rows).sort();
        expect(run({ col: 'uPhoto', kind: 'thumb', filled: true })).toEqual(['u1', 'u3']);
        expect(run({ col: 'uPhoto', kind: 'thumb', empty: true })).toEqual(['u2']);
        expect(columnItemLabel('unions', { col: 'uPhoto', kind: 'thumb', filled: true })).toBe('Photo with photo');
        expect(columnItemLabel('unions', { col: 'uPhoto', kind: 'thumb', empty: true })).toBe('Photo without photo');
    });

    it('a cell\'s Only / Without are the unions with and without a photo', () => {
        const m = build();
        const row = m.unionRows.get('u1' as never)!;
        const line: GridLine = { kind: 'row', row, union: null, n: 0, expanded: null };
        const choices = cellChoices(m, 'unions', line, col(), cellOf(m, row, col()))!;
        expect(choices.only).toEqual({ col: 'uPhoto', kind: 'thumb', filled: true });
        expect(choices.without).toEqual({ col: 'uPhoto', kind: 'thumb', empty: true });
    });
});
