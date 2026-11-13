/**
 * The Research overview's own window by its width (spec 083 §4): one, two or
 * three columns of sections, each column scrolled by itself. Pure logic: how
 * many columns a width holds (with a hysteresis so a drag on the border does
 * not flicker), how tall a section is guessed to be, and how the sections
 * are split into contiguous columns in their reading order.
 */

/** Two columns from this width of the window's content on (below: one, as the panel). */
export const OVERVIEW_WINDOW_COLS_2 = 1100;
/** Three columns from this width on. */
export const OVERVIEW_WINDOW_COLS_3 = 1600;
/** Back to fewer columns only this far under a threshold (up at the threshold itself). */
export const OVERVIEW_COLS_HYSTERESIS = 24;
/** A third column shorter than this share of the columns' height: two columns instead. */
export const OVERVIEW_SMALL_COLUMN = 0.2;
/** One column at most this wide; the columns stand centred in a wider window. */
export const OVERVIEW_COLUMN_MAX = 660;

export type OverviewColumns = 1 | 2 | 3;

/**
 * How many columns `width` holds, given the count drawn now (`prev`, null:
 * none yet). Up when a threshold is reached, down only once the width is
 * `OVERVIEW_COLS_HYSTERESIS` under it.
 */
export function overviewColumnCount(width: number, prev: OverviewColumns | null): OverviewColumns {
    const plain: OverviewColumns = width >= OVERVIEW_WINDOW_COLS_3 ? 3 : width >= OVERVIEW_WINDOW_COLS_2 ? 2 : 1;
    if (prev === null || plain >= prev) return plain;
    // Fewer columns than now: each threshold left counts only this far under it.
    const h = OVERVIEW_COLS_HYSTERESIS;
    if (prev === 3 && width >= OVERVIEW_WINDOW_COLS_3 - h) return 3;
    if (prev >= 2 && width >= OVERVIEW_WINDOW_COLS_2 - h) return 2;
    return 1;
}

/** A section as the split sees it: its key, folded or not, and how many rows it has (a search does not count). */
export interface SectionEstimate {
    key: string;
    collapsed: boolean;
    /**
     * Lines: the lines; Progress: its rows; Queue: the tasks loaded; Awaiting
     * action: phases + groups; What the research knows: its rows. Now: unused.
     */
    rows: number;
}

/** A section's guessed height in px (§4): folded 46, else by its kind and rows. */
export function estimateSectionHeight(s: SectionEstimate): number {
    if (s.collapsed) return 46;
    const n = Math.max(0, s.rows);
    switch (s.key) {
        case 'working': return 110;
        case 'directions': return 46 + 48 * n;
        case 'changes': return 46 + 46 * n;
        case 'queue': return 200 + 52 * n;
        case 'waiting': return 170 + 40 * n;
        case 'knows': return 160 + 44 * n;
        default: return 46 + 44 * n;
    }
}

const sumOf = (heights: readonly number[], ix: readonly number[]): number => ix.reduce((a, i) => a + heights[i], 0);

/**
 * Split `heights` (in reading order) into at most `k` contiguous groups of
 * indices: the tallest group as short as possible (±1 px counts as equal),
 * then the smallest sum of squares (the short columns evened out). Every
 * group has at least one section; fewer sections than `k` give fewer groups.
 */
export function partitionContiguous(heights: readonly number[], k: number): number[][] {
    const n = heights.length;
    if (n === 0) return [];
    const parts = Math.max(1, Math.min(k, n));
    if (parts === 1) return [heights.map((_, i) => i)];
    let best: { mx: number; sq: number; groups: number[][] } | null = null;
    const range = (from: number, to: number): number[] => Array.from({ length: to - from }, (_, j) => from + j);
    const walk = (start: number, left: number, acc: number[][]): void => {
        if (left === 1) {
            const groups = [...acc, range(start, n)];
            const sums = groups.map(g => sumOf(heights, g));
            const mx = Math.max(...sums);
            const sq = sums.reduce((a, v) => a + v * v, 0);
            if (!best || mx < best.mx - 1 || (Math.abs(mx - best.mx) <= 1 && sq < best.sq)) best = { mx, sq, groups };
            return;
        }
        for (let end = start + 1; end <= n - left + 1; end++) walk(end, left - 1, [...acc, range(start, end)]);
    };
    walk(0, parts, []);
    return best!.groups;
}

/**
 * The columns of the window (groups of indices into `heights`): `n` of them,
 * except that three columns of which one would hold less than
 * `OVERVIEW_SMALL_COLUMN` of `areaHeight` (the columns' height) become two,
 * split anew. Never down to one for that reason.
 */
export function planOverviewColumns(heights: readonly number[], n: OverviewColumns, areaHeight: number): number[][] {
    const groups = partitionContiguous(heights, n);
    if (n === 3 && groups.length === 3 && groups.some(g => sumOf(heights, g) < areaHeight * OVERVIEW_SMALL_COLUMN)) {
        return partitionContiguous(heights, 2);
    }
    return groups;
}
