/**
 * A row's short action started from its ⋯ menu (waiting buttons §4, 4a, 4b):
 * the menu closes as before and the row carries the state — locked at once
 * (its ⋯ takes no click), after 120 ms the spinner in the ⋯'s place (and, where
 * the row says it, its quiet words such as "Pausing…"), kept 300 ms at least
 * once shown. The answer ends it; a refusal is the row's own sentence (its box
 * with "Try again"), drawn by the caller.
 *
 * Rows are drawn anew from their data (a panel redraw), so the state lives
 * here by id and each drawing asks for it; its changes ask the caller to draw
 * again. The overview's own window draws the rows as the main window has them
 * (`snapshot` / `mirror`).
 */

import { BUSY_MIN_MS, BUSY_SHOW_MS, announceBusy, busySpinHtml } from './busy.js';

export interface RowBusyView {
    /** Past 120 ms: the spinner and the words are seen. */
    shown: boolean;
    /** The words ("Saving…", "Pausing…"). */
    label: string;
}

interface Row {
    label: string;
    shown: boolean;
    shownAt: number;
    timer: ReturnType<typeof setTimeout> | null;
}

/** A row of a mirrored snapshot (the overview's own window). */
export interface RowBusyMirror { id: string; label: string; shown: boolean }

export class RowBusy {
    private readonly rows = new Map<string, Row>();

    /** A write of row `id` starts: locked now, its look after 120 ms (`redraw` draws the rows again then). */
    start(id: string, label: string, redraw: () => void): void {
        const prev = this.rows.get(id);
        if (prev?.timer) clearTimeout(prev.timer);
        const row: Row = { label, shown: false, shownAt: 0, timer: null };
        row.timer = setTimeout(() => {
            row.timer = null;
            if (this.rows.get(id) !== row) return;
            row.shown = true;
            row.shownAt = Date.now();
            announceBusy(label);
            redraw();
        }, BUSY_SHOW_MS);
        this.rows.set(id, row);
    }

    /**
     * The answer came: resolves when the row may be drawn at rest (a state once shown stays 300 ms at least);
     * false when another write of the row began meanwhile.
     */
    async end(id: string): Promise<boolean> {
        const row = this.rows.get(id);
        if (!row) return true;
        if (row.timer) { clearTimeout(row.timer); row.timer = null; }
        if (row.shown) {
            const left = row.shownAt + BUSY_MIN_MS - Date.now();
            if (left > 0) await new Promise(resolve => setTimeout(resolve, left));
        }
        if (this.rows.get(id) !== row) return false;
        this.rows.delete(id);
        return true;
    }

    has(id: string): boolean {
        return this.rows.has(id);
    }

    /** The row's state (null: at rest). */
    view(id: string): RowBusyView | null {
        const row = this.rows.get(id);
        return row ? { shown: row.shown, label: row.label } : null;
    }

    ids(): string[] {
        return [...this.rows.keys()];
    }

    snapshot(): RowBusyMirror[] {
        return [...this.rows].map(([id, r]) => ({ id, label: r.label, shown: r.shown }));
    }

    /** The rows as another window has them (no timers here: that window says when they show and end). */
    mirror(list: readonly (RowBusyMirror | string)[]): void {
        for (const r of this.rows.values()) if (r.timer) clearTimeout(r.timer);
        this.rows.clear();
        for (const x of list) {
            const m = typeof x === 'string' ? { id: x, label: '', shown: true } : x;
            this.rows.set(m.id, { label: m.label, shown: m.shown, shownAt: 0, timer: null });
        }
    }

    /** Test hook: every row at rest. */
    clear(): void {
        this.mirror([]);
    }
}

/**
 * The ⋯ of a row while its write is on its way: locked (`aria-disabled`, a click goes nowhere), and past
 * 120 ms the spinner in the ⋯'s place at the same size (`.bl`, `data-busy="busy"`, `aria-busy`). True: it is
 * busy (the caller sets no click).
 */
export function drawRowMoreBusy(more: HTMLElement, view: RowBusyView | null): boolean {
    if (!view) return false;
    more.setAttribute('aria-disabled', 'true');
    if (!view.shown) {
        more.dataset.busy = 'lock';
        return true;
    }
    const glyph = more.textContent ?? '⋯';
    more.innerHTML = `<span class="bl"><span class="b-idle"></span><span class="b-busy" aria-hidden="true">${busySpinHtml()}</span></span>`;
    more.querySelector('.b-idle')!.textContent = glyph;
    more.dataset.busy = 'busy';
    more.setAttribute('aria-busy', 'true');
    return true;
}

/** The row's quiet words once shown ("Pausing…" with the 12 px spinner); null before 120 ms and at rest. */
export function rowBusyStatusEl(view: RowBusyView | null): HTMLElement | null {
    if (!view?.shown || !view.label) return null;
    const st = document.createElement('span');
    st.className = 'busy-st row-busy-st';
    st.innerHTML = busySpinHtml(12);
    st.append(view.label);
    return st;
}

/**
 * A link in a row while the row's write is on its way (§5, 5b): its text stays, the 12 px spinner in its slot
 * after it (the slot kept from the start, so the line does not move). True: it is busy (the caller sets no click).
 */
export function drawRowLinkBusy(link: HTMLElement, view: RowBusyView | null): boolean {
    let slot = link.querySelector<HTMLElement>(':scope > .busy-slot');
    if (!slot) {
        slot = document.createElement('span');
        slot.className = 'busy-slot';
        slot.setAttribute('aria-hidden', 'true');
        link.appendChild(slot);
    }
    if (!view) return false;
    link.setAttribute('aria-disabled', 'true');
    if (!view.shown) {
        link.dataset.busy = 'lock';
        return true;
    }
    slot.innerHTML = busySpinHtml(12);
    link.dataset.busy = 'busy';
    link.setAttribute('aria-busy', 'true');
    return true;
}
