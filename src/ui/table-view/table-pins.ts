/**
 * Pinned rows of the Table (spec 103 U3, §3; decisions D5, D7).
 *
 * Rows pinned stay under the head while the body scrolls. They belong to one
 * tree and one row type: another tree or row type drops them; a view, a
 * filter or a search keeps them. They live in the window's memory only (each
 * window has its own module state), never in a view, and do not make a view
 * "changed". At most PIN_MAX rows; a row gone from the data drops out.
 *
 * Their order is the table's (its sort, else its own order) and, as the
 * body's rows after an edit (spec 073 §10.3), it changes only with the
 * sort, the filter, the search or the view (D7 a). Pure state, no DOM.
 */

import type { RowType } from './table-model.js';

/** At most this many rows are pinned. */
export const PIN_MAX = 10;

/** The pin's outline (the designer's 24 × 24 drawing): filled in the pinned rows, an outline on their own rows. */
const PIN_PATH = '<path d="M9 4h6l-1 6 3 3H7l3-3-1-6zM12 13v7"/>';

/** The pin as an SVG of `size` px; its fill comes from the stylesheet. */
export function pinSvg(size: number): string {
    return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"`
        + ` stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${PIN_PATH}</svg>`;
}

/** The pinned rows of one window's Table. */
export class TablePins {
    private tree: string | null = null;
    private type: RowType | null = null;
    /** Row keys, in the order they were pinned. */
    private keys: string[] = [];
    /** Their order as last drawn and what it was drawn for (D7 a). */
    private order: string[] = [];
    private orderFor = '';

    /** The pins of this tree and row type: another tree or row type drops them. */
    use(tree: string, type: RowType): void {
        if (tree === this.tree && type === this.type) return;
        this.tree = tree;
        this.type = type;
        this.clear();
    }

    count(): number { return this.keys.length; }
    has(key: string): boolean { return this.keys.includes(key); }
    all(): readonly string[] { return this.keys; }

    /** The rows not pinned yet among `keys` (each once). */
    fresh(keys: readonly string[]): string[] {
        return [...new Set(keys)].filter(k => !this.keys.includes(k));
    }

    /** Pinning `keys` keeps within PIN_MAX (rows already pinned count once). */
    canPin(keys: readonly string[]): boolean {
        const add = this.fresh(keys).length;
        return add > 0 && this.keys.length + add <= PIN_MAX;
    }

    /** Pin the rows; false (nothing pinned) when they would go over PIN_MAX. */
    pin(keys: readonly string[]): boolean {
        if (!this.canPin(keys)) return false;
        this.keys = [...this.keys, ...this.fresh(keys)];
        return true;
    }

    unpin(key: string): boolean {
        const before = this.keys.length;
        this.keys = this.keys.filter(k => k !== key);
        return this.keys.length !== before;
    }

    clear(): void {
        this.keys = [];
        this.order = [];
        this.orderFor = '';
    }

    /** Rows gone from the data drop out. */
    prune(exists: (key: string) => boolean): void {
        if (this.keys.some(k => !exists(k))) this.keys = this.keys.filter(exists);
    }

    /**
     * The pinned rows in the table's order (D7 a): ordered by `rank` when
     * `ctx` (the sort, the filter, the search, the view) or the pinned rows
     * changed, else in the order last given, so an edit does not move them.
     */
    ordered(ctx: string, rank: (keys: readonly string[]) => ReadonlyMap<string, number>): string[] {
        const same = this.order.length === this.keys.length && this.keys.every(k => this.order.includes(k));
        if (ctx === this.orderFor && same) return this.order;
        const r = rank(this.keys);
        const at = (k: string): number => r.get(k) ?? Number.MAX_SAFE_INTEGER;
        this.order = [...this.keys].sort((a, b) => at(a) - at(b) || this.keys.indexOf(a) - this.keys.indexOf(b));
        this.orderFor = ctx;
        return this.order;
    }
}

/**
 * Each pinned row's place in the table's order: a shown row its index; a
 * row the filter hides just after the last shown row the table's order
 * puts before it (`order`: the shown and the hidden rows sorted together).
 */
export function pinRanks(
    keys: readonly string[], shown: readonly string[], order: () => readonly string[],
): Map<string, number> {
    const at = new Map<string, number>();
    shown.forEach((k, i) => at.set(k, i));
    const out = new Map<string, number>();
    const hidden = new Set<string>();
    for (const k of keys) {
        const i = at.get(k);
        if (i === undefined) hidden.add(k);
        else out.set(k, i);
    }
    if (!hidden.size) return out;
    let last = -1;
    let step = 0;
    for (const k of order()) {
        const i = at.get(k);
        if (i !== undefined) { last = i; step = 0; continue; }
        if (hidden.has(k)) out.set(k, last + 0.5 + (step++) / 1000);
    }
    return out;
}
