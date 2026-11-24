import { describe, expect, it } from 'vitest';
import { knowsGroupOptions, knowsGroupShown, knowsGroups, isKnowsGroup, type KnowsGroupLine } from '../knows-group.js';

interface Row { id: string; lines: string[]; island?: boolean }

const LINES: KnowsGroupLine[] = [
    { id: 'L1', name: 'Paternal ancestors', done: false },
    { id: 'L2', name: 'Who was the father', done: false },
    { id: 'L3', name: 'Maternal ancestors', done: true },
];
const ctx = {
    lines: LINES,
    lineIdsOf: (r: Row) => new Set(r.lines),
    islandOf: (r: Row) => !!r.island,
};
const ids = (rows: Row[]): string[] => rows.map(r => r.id);

describe('knows groups (spec 140)', () => {
    it('offers By line only with lines', () => {
        expect(knowsGroupOptions(true)).toEqual(['none', 'line', 'tree']);
        expect(knowsGroupOptions(false)).toEqual(['none', 'tree']);
    });

    it('draws a stored By line without lines, or fewer than two rows, as None', () => {
        expect(knowsGroupShown('line', false, 5)).toBe('none');
        expect(knowsGroupShown('line', true, 5)).toBe('line');
        expect(knowsGroupShown('tree', false, 5)).toBe('tree');
        expect(knowsGroupShown('tree', true, 1)).toBe('none');
        expect(knowsGroupShown('line', true, 0)).toBe('none');
        expect(knowsGroupShown('none', true, 9)).toBe('none');
    });

    it('reads only the three values back', () => {
        expect(isKnowsGroup('line')).toBe(true);
        expect(isKnowsGroup('lines')).toBe(false);
        expect(isKnowsGroup(undefined)).toBe(false);
    });

    it('puts a row of two lines in both, No line last, empty groups left out, the order of rows kept', () => {
        const rows: Row[] = [
            { id: 'c1', lines: ['L2'] },
            { id: 'h1', lines: ['L1', 'L2'] },
            { id: 'h2', lines: [] },
            { id: 'h3', lines: ['L1'] },
            { id: 'h4', lines: ['L9'] },
        ];
        const g = knowsGroups(rows, 'line', ctx);
        expect(g.map(x => x.key)).toEqual(['L1', 'L2', 'noLine']);
        expect(ids(g[0].rows)).toEqual(['h1', 'h3']);
        expect(ids(g[1].rows)).toEqual(['c1', 'h1']);
        // A line the research does not list counts as none.
        expect(ids(g[2].rows)).toEqual(['h2', 'h4']);
        expect(g[2].kind).toBe('noLine');
    });

    it('keeps an ended line as its own group marked done', () => {
        const g = knowsGroups([{ id: 'a', lines: ['L3'] }, { id: 'b', lines: ['L1'] }], 'line', ctx);
        expect(g.map(x => x.key)).toEqual(['L1', 'L3']);
        expect(g[1].line?.done).toBe(true);
        expect(g[0].line?.done).toBe(false);
    });

    it('splits in the tree and outside it; without an island one group In the tree', () => {
        const rows: Row[] = [{ id: 'a', lines: [] }, { id: 'b', lines: [], island: true }, { id: 'c', lines: [] }];
        const g = knowsGroups(rows, 'tree', ctx);
        expect(g.map(x => [x.key, ids(x.rows)])).toEqual([['in', ['a', 'c']], ['out', ['b']]]);
        const only = knowsGroups(rows.filter(r => !r.island), 'tree', ctx);
        expect(only.map(x => x.key)).toEqual(['in']);
        expect(only[0].kind).toBe('in');
    });
});
