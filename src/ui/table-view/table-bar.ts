/**
 * Table view (spec 073 §1.4, §1.5, §2): the table's bar and status line.
 *
 * Row 1: the row type (a segmented radio group; on a phone a button that
 * opens a sheet), then slots the later parts fill (the view picker §9, search
 * §8, Columns §4, Export §11) and the phone's ⋯ (§12, which takes Columns and
 * Export). Row 2 holds the filter chips (§8; hidden while empty) — the slot
 * whose content the selection bar of a later phase replaces (§15). The status line under the grid: "N of M people", the sort, and the
 * Marks button (§7, hidden until it has its bubble).
 */

import { strings } from '../../strings.js';
import { columnById, columnLabel, type SortSpec } from './table-columns.js';
import { ROW_TYPES, type RowType } from './table-model.js';

export interface BarHandlers {
    /** A row type was chosen (segment or sheet). */
    onRowType(type: RowType): void;
    /** The phone's row-type button: open the sheet. */
    onRowTypeSheet(): void;
    /** The phone's ⋯ (12a): Columns, Export, Coverage row, Expand or Collapse unions. */
    onMoreMenu(): void;
}

function esc(text: string): string {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const COUNT_KEY: Record<RowType, 'p' | 'u'> = { persons: 'p', unions: 'u' };

/** "12 of 38 people" for a row type. */
export function countText(type: RowType, shown: number, total: number): string {
    return strings.table.countOf[COUNT_KEY[type]](shown, total);
}

/** "Sort: Birth date ↑, Name ↓" (empty without a sort). */
export function sortText(type: RowType, sort: readonly SortSpec[]): string {
    const cols = sort
        .map(s => { const col = columnById(type, s.col); return col ? `${columnLabel(col)} ${s.dir === 'desc' ? '↓' : '↑'}` : ''; })
        .filter(Boolean);
    return cols.length ? strings.table.sortedBy(cols.join(', ')) : '';
}

/** The bar's skeleton; `updateBar` fills the row type. */
export function createBar(handlers: BarHandlers): HTMLElement {
    const bar = document.createElement('div');
    bar.className = 'tv-bar';
    bar.innerHTML = '<div class="tv-bar-row1">'
        + `<div class="tv-rowtype" role="radiogroup" aria-label="${esc(strings.table.rowType)}"></div>`
        + '<button type="button" class="tv-rowtype-btn" aria-haspopup="dialog"></button>'
        + '<div class="tv-slot tv-slot-view"></div>'
        + '<div class="tv-bar-spacer"></div>'
        + '<div class="tv-slot tv-slot-search"></div>'
        + '<div class="tv-slot tv-slot-cols"></div>'
        + '<div class="tv-slot tv-slot-export"></div>'
        + '<div class="tv-slot tv-slot-more">'
        + `<button type="button" class="tv-more-menu-btn" aria-haspopup="menu" aria-label="${esc(strings.table.moreActions)}" title="${esc(strings.table.moreActions)}">⋯</button>`
        + '</div>'
        + '</div>'
        + '<div class="tv-bar-row2 tv-chips" hidden></div>';
    const seg = bar.querySelector<HTMLElement>('.tv-rowtype')!;
    seg.addEventListener('click', (e) => {
        const btn = (e.target as Element).closest<HTMLElement>('[data-rowtype]');
        if (btn) handlers.onRowType(btn.dataset.rowtype as RowType);
    });
    // Arrows move the choice within the radio group (one tab stop).
    seg.addEventListener('keydown', (e) => {
        if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key)) return;
        const btns = [...seg.querySelectorAll<HTMLElement>('[data-rowtype]')];
        const at = btns.findIndex(b => b.getAttribute('aria-checked') === 'true');
        const step = e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 1;
        const next = e.key === 'Home' ? 0 : e.key === 'End' ? btns.length - 1 : (at + step + btns.length) % btns.length;
        e.preventDefault();
        handlers.onRowType(btns[next].dataset.rowtype as RowType);
        seg.querySelector<HTMLElement>(`[data-rowtype="${btns[next].dataset.rowtype}"]`)?.focus();
    });
    bar.querySelector('.tv-rowtype-btn')!.addEventListener('click', () => handlers.onRowTypeSheet());
    bar.querySelector('.tv-more-menu-btn')!.addEventListener('click', () => handlers.onMoreMenu());
    return bar;
}

/** The row-type segment and the phone button for the current type and counts. */
export function updateBar(bar: HTMLElement, type: RowType, counts: Record<RowType, number>): void {
    const seg = bar.querySelector<HTMLElement>('.tv-rowtype')!;
    seg.innerHTML = ROW_TYPES.map(t => {
        const on = t === type;
        const label = strings.table.rows[t];
        return `<button type="button" class="segment-btn${on ? ' active' : ''}" role="radio" data-rowtype="${t}"`
            + ` aria-checked="${on}" tabindex="${on ? 0 : -1}" aria-label="${esc(strings.table.rowTypeAria(label, counts[t]))}">`
            + `${esc(label)}<span class="tv-rowtype-count" aria-hidden="true">${counts[t]}</span></button>`;
    }).join('');
    const btn = bar.querySelector<HTMLElement>('.tv-rowtype-btn')!;
    const label = strings.table.rows[type];
    btn.textContent = `${label} · ${counts[type]} ▾`;
    btn.setAttribute('aria-label', `${strings.table.rowType}: ${strings.table.rowTypeAria(label, counts[type])}`);
}

/** The status line's skeleton. */
export function createStatus(): HTMLElement {
    const el = document.createElement('div');
    el.className = 'tv-status';
    el.innerHTML = '<span class="tv-status-count" aria-live="polite"></span>'
        + '<span class="tv-status-sort"></span>'
        + '<span class="tv-status-right">'
        + `<span class="tv-status-checks" role="status" hidden><span class="tv-checks-ring" aria-hidden="true">◌</span> ${esc(strings.table.checksRunning)}</span>`
        + `<span class="tv-status-ro" title="${esc(strings.table.readOnly)}" hidden><span class="tv-ro-long">${esc(strings.table.readOnly)}</span>`
        + `<span class="tv-ro-short">${esc(strings.table.readOnlyShort)}</span></span>`
        + `<button type="button" class="tv-legend-btn" aria-haspopup="dialog">${esc(strings.table.legend)} ⓘ</button>`
        + '</span>';
    return el;
}

/**
 * The count, the sort, (§13i) "Checks are running…" while the tree's
 * findings are computed and (§13j) the read-only sentence.
 */
export function updateStatus(el: HTMLElement, type: RowType, shown: number, total: number, sort: readonly SortSpec[], checking = false, readOnly = false): void {
    el.querySelector<HTMLElement>('.tv-status-ro')!.hidden = !readOnly;
    el.querySelector('.tv-status-count')!.textContent = countText(type, shown, total);
    el.querySelector('.tv-status-sort')!.textContent = sortText(type, sort);
    el.querySelector<HTMLElement>('.tv-status-checks')!.hidden = !checking;
}
