/**
 * Table view (spec 073 §1.6): which rows and columns are drawn.
 *
 * Rows have a fixed height: the drawn window is the visible rows plus an
 * overscan above and below. Columns are virtualized only past a threshold:
 * the pinned ones always, the rest when they meet the scrolled range (with a
 * buffer of columns on each side). Pure functions, unit-tested.
 */

export const ROW_OVERSCAN = 10;
/** More visible columns than this: only the scrolled range is drawn (§1.6). */
export const COLUMN_VIRTUAL_THRESHOLD = 30;
export const COLUMN_BUFFER = 2;

/** The rows [start, end) to draw for a scroll position. */
export function rowWindow(scrollTop: number, viewport: number, rowHeight: number, total: number, overscan = ROW_OVERSCAN): { start: number; end: number } {
    if (total <= 0 || rowHeight <= 0) return { start: 0, end: 0 };
    const first = Math.floor(Math.max(0, scrollTop) / rowHeight);
    const visible = Math.ceil(Math.max(0, viewport) / rowHeight) + 1;
    const start = Math.max(0, Math.min(total - 1, first) - overscan);
    const end = Math.min(total, first + visible + overscan);
    return { start, end: Math.max(start, end) };
}

/** Each column's left edge (and the total width as the last entry). */
export function columnOffsets(widths: readonly number[]): number[] {
    const out = new Array<number>(widths.length + 1);
    out[0] = 0;
    for (let i = 0; i < widths.length; i++) out[i + 1] = out[i] + widths[i];
    return out;
}

/** The sticky `left` of each pinned column: the widths of the pinned ones before it (§4.5). */
export function stickyLefts(widths: readonly number[], pinned: number): number[] {
    return columnOffsets(widths.slice(0, Math.max(0, Math.min(pinned, widths.length)))).slice(0, -1);
}

export interface ColumnWindow {
    /** Indexes of the columns drawn, left to right (the pinned ones first). */
    indices: number[];
    /** Width skipped between the last pinned and the first drawn scrolling column. */
    before: number;
    /** Width skipped after the last drawn column. */
    after: number;
    total: number;
}

/**
 * The columns to draw for a horizontal scroll position. The first `pinned`
 * columns stay on screen (sticky) and are always drawn.
 */
export function columnWindow(widths: readonly number[], pinned: number, scrollLeft: number, viewport: number,
    threshold = COLUMN_VIRTUAL_THRESHOLD, buffer = COLUMN_BUFFER): ColumnWindow {
    const offsets = columnOffsets(widths);
    const total = offsets[widths.length];
    const n = widths.length;
    const pin = Math.max(0, Math.min(pinned, n));
    if (n <= threshold) return { indices: widths.map((_, i) => i), before: 0, after: 0, total };
    const pinnedWidth = offsets[pin];
    // The scrolling columns under the viewport right of the pinned ones.
    const from = Math.max(0, scrollLeft) + pinnedWidth;
    const to = Math.max(0, scrollLeft) + Math.max(viewport, pinnedWidth);
    let first = pin;
    while (first < n - 1 && offsets[first + 1] <= from) first++;
    let last = first;
    while (last < n - 1 && offsets[last + 1] < to) last++;
    first = Math.max(pin, first - buffer);
    last = Math.min(n - 1, last + buffer);
    const indices: number[] = [];
    for (let i = 0; i < pin; i++) indices.push(i);
    for (let i = first; i <= last; i++) indices.push(i);
    return { indices, before: offsets[first] - pinnedWidth, after: total - offsets[last + 1], total };
}
