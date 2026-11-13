import { describe, it, expect } from 'vitest';
import {
    OVERVIEW_COLS_HYSTERESIS, OVERVIEW_WINDOW_COLS_2, OVERVIEW_WINDOW_COLS_3, estimateSectionHeight, overviewColumnCount,
    partitionContiguous, planOverviewColumns, type OverviewColumns, type SectionEstimate,
} from '../overview-columns';

/** A large research as the design's examples have it: four lines, Progress open, 106 waiting items in 8 groups, 300 rows known. */
const big = (o: { queueOpen?: boolean } = {}): SectionEstimate[] => [
    { key: 'working', collapsed: false, rows: 0 },
    { key: 'waiting', collapsed: false, rows: 2 + 8 },
    { key: 'directions', collapsed: false, rows: 4 },
    { key: 'changes', collapsed: false, rows: 4 },
    { key: 'queue', collapsed: !o.queueOpen, rows: 50 },
    { key: 'knows', collapsed: false, rows: 300 },
];

/** The keys of each column. */
function plan(secs: SectionEstimate[], n: OverviewColumns, area: number): string[][] {
    const heights = secs.map(estimateSectionHeight);
    return planOverviewColumns(heights, n, area).map(g => g.map(i => secs[i].key));
}

describe('the overview window\'s column count', () => {
    it('one under 1100, two from 1100, three from 1600', () => {
        expect(overviewColumnCount(1024, null)).toBe(1);
        expect(overviewColumnCount(1099, null)).toBe(1);
        expect(overviewColumnCount(OVERVIEW_WINDOW_COLS_2, null)).toBe(2);
        expect(overviewColumnCount(1440, null)).toBe(2);
        expect(overviewColumnCount(OVERVIEW_WINDOW_COLS_3, null)).toBe(3);
        expect(overviewColumnCount(2000, null)).toBe(3);
    });

    it('up at the threshold, down only 24 px under it (no flicker while the border is dragged)', () => {
        expect(OVERVIEW_COLS_HYSTERESIS).toBe(24);
        // Two columns: still two down to 1076, one under it.
        expect(overviewColumnCount(1090, 2)).toBe(2);
        expect(overviewColumnCount(1076, 2)).toBe(2);
        expect(overviewColumnCount(1075, 2)).toBe(1);
        // One column: two only at 1100 itself.
        expect(overviewColumnCount(1090, 1)).toBe(1);
        expect(overviewColumnCount(1100, 1)).toBe(2);
        // Three columns: still three down to 1576, then two; far down at once to one.
        expect(overviewColumnCount(1590, 3)).toBe(3);
        expect(overviewColumnCount(1576, 3)).toBe(3);
        expect(overviewColumnCount(1575, 3)).toBe(2);
        expect(overviewColumnCount(1080, 3)).toBe(2);
        expect(overviewColumnCount(900, 3)).toBe(1);
        // Two: three only at 1600.
        expect(overviewColumnCount(1590, 2)).toBe(2);
        expect(overviewColumnCount(1600, 2)).toBe(3);
        // Up skips a step when the window jumps.
        expect(overviewColumnCount(1700, 1)).toBe(3);
    });
});

describe('a section\'s guessed height', () => {
    it('as the table of §4 says, a folded section 46', () => {
        expect(estimateSectionHeight({ key: 'working', collapsed: false, rows: 0 })).toBe(110);
        expect(estimateSectionHeight({ key: 'directions', collapsed: false, rows: 4 })).toBe(46 + 4 * 48);
        expect(estimateSectionHeight({ key: 'changes', collapsed: false, rows: 4 })).toBe(46 + 4 * 46);
        expect(estimateSectionHeight({ key: 'queue', collapsed: false, rows: 50 })).toBe(200 + 52 * 50);
        expect(estimateSectionHeight({ key: 'queue', collapsed: true, rows: 50 })).toBe(46);
        expect(estimateSectionHeight({ key: 'waiting', collapsed: false, rows: 10 })).toBe(170 + 40 * 10);
        expect(estimateSectionHeight({ key: 'knows', collapsed: false, rows: 300 })).toBe(160 + 44 * 300);
        expect(estimateSectionHeight({ key: 'knows', collapsed: true, rows: 300 })).toBe(46);
    });
});

describe('the sections split into contiguous columns', () => {
    it('4b: 2000 px, a large research: Now + Awaiting | Lines + Progress + Queue | What the research knows', () => {
        expect(plan(big(), 3, 890)).toEqual([['working', 'waiting'], ['directions', 'changes', 'queue'], ['knows']]);
    });

    it('4c: the Queue unfolded with 50 rows gets a column of its own, Lines and Progress go to Awaiting action', () => {
        expect(plan(big({ queueOpen: true }), 3, 890)).toEqual([['working', 'waiting', 'directions', 'changes'], ['queue'], ['knows']]);
    });

    it('4e: 1280 px, two columns: everything but What the research knows | What the research knows', () => {
        expect(plan(big(), 2, 890)).toEqual([['working', 'waiting', 'directions', 'changes', 'queue'], ['knows']]);
    });

    it('4j: knows first, Lines hidden, Progress folded: a third column of Now alone (under 20 %) makes two columns', () => {
        const secs: SectionEstimate[] = [
            { key: 'knows', collapsed: false, rows: 300 },
            { key: 'working', collapsed: false, rows: 0 },
            { key: 'waiting', collapsed: false, rows: 10 },
            { key: 'changes', collapsed: true, rows: 4 },
            { key: 'queue', collapsed: true, rows: 50 },
        ];
        // Three would be knows | Now | the rest.
        expect(partitionContiguous(secs.map(estimateSectionHeight), 3).map(g => g.map(i => secs[i].key)))
            .toEqual([['knows'], ['working'], ['waiting', 'changes', 'queue']]);
        expect(plan(secs, 3, 790)).toEqual([['knows'], ['working', 'waiting', 'changes', 'queue']]);
    });

    it('three columns stay when none is under 20 % of the height', () => {
        const secs: SectionEstimate[] = [
            { key: 'working', collapsed: false, rows: 0 },
            { key: 'waiting', collapsed: false, rows: 8 },
            { key: 'queue', collapsed: false, rows: 15 },
        ];
        expect(plan(secs, 3, 450)).toEqual([['working'], ['waiting'], ['queue']]);
        // A taller window: Now alone is under 20 % of it, two columns.
        expect(plan(secs, 3, 800)).toEqual([['working', 'waiting'], ['queue']]);
    });

    it('two columns never become one for a small column', () => {
        const heights = [46, 46, 13360];
        expect(planOverviewColumns(heights, 2, 2000)).toEqual([[0, 1], [2]]);
    });

    it('fewer sections than columns: one column each; none: none; one column: all in it', () => {
        expect(partitionContiguous([300, 500], 3)).toEqual([[0], [1]]);
        expect(partitionContiguous([], 3)).toEqual([]);
        expect(partitionContiguous([1, 2, 3], 1)).toEqual([[0, 1, 2]]);
    });

    it('the tallest column as short as possible, a tie (±1 px) by the smallest sum of squares', () => {
        // Max 600 either way ([100,500] | [600] or [100] | [500,600] is worse): the even one wins.
        expect(partitionContiguous([100, 500, 600], 2)).toEqual([[0, 1], [2]]);
        // A tie within 1 px: the evener split.
        expect(partitionContiguous([400, 200, 200, 601], 3)).toEqual([[0], [1, 2], [3]]);
    });
});
