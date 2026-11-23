/**
 * The Table's Statistics chip (spec 138 §8): a value's people as one chip,
 * named after the value, counted as a filter, never kept in a view, the
 * stored work or a list's rule.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import type { PersonId, StromData } from '../types.js';
import { setLanguage } from '../strings.js';
import { buildTableModel, type TableModel, type TableRow } from '../ui/table-view/table-model.js';
import {
    activeFilterCount, availableChips, chipAvailable, chipLabel, chipItem, emptyFilter, filterRows, setChip, STATS_CHIP,
} from '../ui/table-view/table-filter.js';
import { defaultTypeState } from '../ui/table-view/table-state.js';
import { viewFromState } from '../ui/table-view/table-views.js';

/** Invented people: Pětioký and Vochomůrka. */
function tree(): StromData {
    const person = (id: string, firstName: string, lastName: string, gender: 'male' | 'female') =>
        ({ id, firstName, lastName, gender, isPlaceholder: false, partnerships: [], parentIds: [], childIds: [], birthDate: '1870' });
    return {
        persons: {
            a: person('a', 'Josef', 'Pětioký', 'male'),
            b: person('b', 'Josef', 'Vochomůrka', 'male'),
            c: person('c', 'Anna', 'Pětioká', 'female'),
            d: person('d', 'Jan', 'Vochomůrka', 'male'),
        },
        partnerships: {},
    } as unknown as StromData;
}

const build = (): TableModel =>
    buildTableModel(tree(), { rev: 1, homeId: 'a' as PersonId, lang: 'en', year: 2026, reliability: { researchTree: false, originFeature: false } });
const ids = (rows: readonly TableRow[]) => rows.map(r => r.id).sort();
const LABEL = 'Statistics: first name Josef';

beforeAll(() => setLanguage('en'));

describe('the Statistics chip (spec 138 §8)', () => {
    it('lets through exactly its people and reads as its label', () => {
        const m = build();
        const f = emptyFilter();
        setChip(f, STATS_CHIP, true, { values: ['a', 'b'], name: LABEL });
        expect(ids(filterRows(m, 'persons', m.persons, f).rows)).toEqual(['a', 'b']);
        expect(chipLabel(m, chipItem(f, STATS_CHIP)!, STATS_CHIP)).toBe(LABEL);
        expect(activeFilterCount(m, 'persons', f)).toBe(1);
    });

    it('belongs to People only and is never a quick chip', () => {
        const m = build();
        expect(chipAvailable(m, 'persons', STATS_CHIP)).toBe(true);
        expect(chipAvailable(m, 'unions', STATS_CHIP)).toBe(false);
        expect(availableChips(m, 'persons')).not.toContain(STATS_CHIP);
    });

    it('is left out of a view (and so of the stored work and a list’s rule), the other filters kept', () => {
        const st = defaultTypeState('persons');
        setChip(st.filter, STATS_CHIP, true, { values: ['a', 'b'], name: LABEL });
        setChip(st.filter, 'deceased', true);
        const view = viewFromState('persons', st, 'v1', 'Mine', '2026-11-23T10:00:00Z');
        expect(view.filter.items).toEqual([{ chip: 'deceased' }]);
        // The window's own state keeps the chip.
        expect(chipItem(st.filter, STATS_CHIP)?.values).toEqual(['a', 'b']);
    });
});
