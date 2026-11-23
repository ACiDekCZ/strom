/**
 * A list that draws only the rows near the view (spec 134 §13h): with
 * thousands of new people a long list of rows would make the guide slow, so
 * only the rows in view and a margin around them (40 rows each way) are in
 * the page; spacers above and below keep the scroll bar's length. Every row
 * has the same height.
 */

/** Rows drawn above and below the ones in view. */
export const VIRTUAL_OVERSCAN = 40;

export interface VisibleWindow {
    /** First row drawn. */
    start: number;
    /** One past the last row drawn. */
    end: number;
    /** Height of the spacer above the drawn rows. */
    padTop: number;
    /** Height of the spacer below them. */
    padBottom: number;
}

/** Which rows of `count` (each `rowHeight` tall) are drawn when the list is scrolled to `scrollTop` in a view `viewport` tall. */
export function visibleWindow(count: number, rowHeight: number, scrollTop: number, viewport: number, overscan = VIRTUAL_OVERSCAN): VisibleWindow {
    if (count <= 0 || rowHeight <= 0) return { start: 0, end: 0, padTop: 0, padBottom: 0 };
    const first = Math.max(0, Math.floor(Math.max(0, scrollTop) / rowHeight));
    const inView = Math.max(1, Math.ceil(Math.max(0, viewport) / rowHeight) + 1);
    const start = Math.max(0, Math.min(count - 1, first) - overscan);
    const end = Math.min(count, first + inView + overscan);
    return { start, end, padTop: start * rowHeight, padBottom: (count - end) * rowHeight };
}

/**
 * The drawn part of a list in a scrolling element. `row(i)` gives the HTML
 * of row i; the rows go between two spacers in `list`. Drawn again on
 * scroll (once a frame) and by `refresh` when the rows change.
 */
export class VirtualList {
    private count = 0;
    private drawn = '';
    private frame = 0;
    private readonly onScroll = (): void => {
        if (this.frame) return;
        this.frame = requestAnimationFrame(() => { this.frame = 0; this.draw(); });
    };

    constructor(
        private readonly scroller: HTMLElement,
        private readonly list: HTMLElement,
        private readonly rowHeight: () => number,
        private row: (i: number) => string,
        /** After each draw (what HTML cannot say, e.g. a checkbox's mixed state). */
        private readonly afterDraw?: () => void,
    ) {
        scroller.addEventListener('scroll', this.onScroll, { passive: true });
    }

    /** New rows (their number and how to draw them); keeps the scroll where it can. */
    refresh(count: number, row: (i: number) => string): void {
        this.count = count;
        this.row = row;
        this.drawn = '';
        this.draw();
    }

    /** Scroll so row i is in view. */
    reveal(i: number): void {
        const h = this.rowHeight();
        const top = i * h;
        if (top < this.scroller.scrollTop) this.scroller.scrollTop = top;
        else if (top + h > this.scroller.scrollTop + this.scroller.clientHeight) this.scroller.scrollTop = top + h - this.scroller.clientHeight;
        this.draw();
    }

    destroy(): void {
        this.scroller.removeEventListener('scroll', this.onScroll);
        if (this.frame) cancelAnimationFrame(this.frame);
    }

    private draw(): void {
        const h = this.rowHeight();
        // A list not laid out yet (a hidden tab) draws the first rows as if its view were 600 px.
        const view = this.scroller.clientHeight || 600;
        const w = visibleWindow(this.count, h, this.scroller.scrollTop, view);
        const key = `${w.start}:${w.end}:${h}`;
        if (key === this.drawn) return;
        this.drawn = key;
        // Keep the focused row's control focused across a redraw.
        const active = document.activeElement as HTMLElement | null;
        const focusKey = active && this.list.contains(active) ? active.dataset.vkey : undefined;
        let html = `<li class="vlist-pad" aria-hidden="true" role="presentation" style="height:${w.padTop}px"></li>`;
        for (let i = w.start; i < w.end; i++) html += this.row(i);
        html += `<li class="vlist-pad" aria-hidden="true" role="presentation" style="height:${w.padBottom}px"></li>`;
        this.list.innerHTML = html;
        this.afterDraw?.();
        if (focusKey) this.list.querySelector<HTMLElement>(`[data-vkey="${CSS.escape(focusKey)}"]`)?.focus();
    }
}
