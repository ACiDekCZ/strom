/**
 * Title… / Kind… / Date… for many files (spec 102 §8d, §8e): which files
 * change, how titles are numbered, research requests at most 500 ids each
 * and grouped by value, and their undo.
 */
import { describe, it, expect } from 'vitest';
import { MaterialItem } from '../materials.js';
import { BULK_CHUNK, bulkDatePlan, bulkEditRequests, bulkKindPlan, bulkTitlePlan, bulkUndoRequests, chunked } from '../ui/material-bulk-ui.js';

const item = (n: number, init: Partial<MaterialItem> = {}): MaterialItem => ({
    key: `m:I${n}`, name: `scan-${n}.jpg`, title: `scan-${n}.jpg`, titled: false, persons: [],
    file: { id: `I${n}` }, ...init,
} as unknown as MaterialItem);

describe('bulk plans', () => {
    it('Title… numbers the untitled files in order, overwriting only when asked', () => {
        const items = [item(1), item(2, { titled: true, title: 'Wedding' }), item(3)];
        expect(bulkTitlePlan(items, ' Box 1924 ', { number: true, overwrite: false }).map(c => [c.item.key, c.title]))
            .toEqual([['m:I1', 'Box 1924 1'], ['m:I3', 'Box 1924 2']]);
        expect(bulkTitlePlan(items, 'Box', { number: false, overwrite: true }).map(c => c.title)).toEqual(['Box', 'Box', 'Box']);
        expect(bulkTitlePlan(items, '  ', { number: true, overwrite: true })).toEqual([]);
    });

    it('Kind… and Date… skip files that already have one unless overwriting; an empty date clears', () => {
        const items = [item(1, { kind: 'photo' }), item(2), item(3, { date: '1931' })];
        expect(bulkKindPlan(items, 'document', false).map(c => c.item.key)).toEqual(['m:I2', 'm:I3']);
        expect(bulkKindPlan(items, 'photo', true).map(c => c.item.key)).toEqual(['m:I2', 'm:I3']);
        expect(bulkDatePlan(items, '1924', false).map(c => c.item.key)).toEqual(['m:I1', 'm:I2']);
        expect(bulkDatePlan(items, '1931', true).map(c => c.item.key)).toEqual(['m:I1', 'm:I2']);
        expect(bulkDatePlan(items, '', false).map(c => [c.item.key, c.date])).toEqual([['m:I3', '']]);
    });

    it('research requests: one per value, at most 500 ids; the undo groups the earlier values', () => {
        expect(BULK_CHUNK).toBe(500);
        expect(chunked([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
        const many = Array.from({ length: 1201 }, (_, i) => ({ item: item(i), kind: 'record' as const }));
        const reqs = bulkEditRequests(many);
        expect(reqs.map(r => r.req.ids.length)).toEqual([500, 500, 201]);
        expect(reqs[0].req).toMatchObject({ kind: 'record' });
        expect(reqs[0].req.title).toBeUndefined();
        const titled = bulkEditRequests(bulkTitlePlan([item(1), item(2)], 'Box', { number: true, overwrite: false }));
        expect(titled.map(r => [r.req.ids, r.req.title])).toEqual([[['I1'], 'Box 1'], [['I2'], 'Box 2']]);
        // A tree's own file (no research id) is not sent.
        expect(bulkEditRequests([{ item: item(9, { file: undefined }), date: '1900' }])).toEqual([]);
        expect(bulkUndoRequests({ I1: { title: '' }, I2: { title: '' }, I3: { title: 'Old' }, I4: {} }))
            .toEqual([{ ids: ['I1', 'I2'], title: '' }, { ids: ['I3'], title: 'Old' }]);
    });
});
