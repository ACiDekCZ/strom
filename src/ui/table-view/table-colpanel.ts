/**
 * Table view (spec 073 §4.4): the Columns panel — on a computer a panel at
 * the right over the grid, on a phone a sheet from the bottom (the same
 * content, taller rows, order by ↑ ↓ only).
 *
 * Title and "10 of 72"; a field that filters the column names in the app's
 * language (groups without a match hide); the groups as foldable heads
 * "▸ Name  2 of 9  all"; the columns with a checkbox, ↑ ↓ on the focused
 * one (Alt+↑/↓), a grip to drag the checked ones (not on a phone). The name
 * stays checked and locked ("pinned"). Then the coverage row switch, "Reset
 * to default" and "Done". The panel only reports; table-ui.ts changes the
 * state and calls `update()`.
 */

import { strings } from '../../strings.js';
import { columnLabel, groupLabel, type ColumnDef, type ColumnGroup } from './table-columns.js';
import type { RowType } from './table-model.js';
import { canMoveColumn, catalogColumns, groupAllColumns, lockedColumn, type RowTypeState } from './table-state.js';

export interface ColumnPanelHandlers {
    onShow(id: string, on: boolean): void;
    onGroupShown(group: string, on: boolean): void;
    onMove(id: string, dir: -1 | 1): void;
    /** The grip's drag: `id` goes to where `targetId` is. */
    onMoveTo(id: string, targetId: string): void;
    /** A phone collapses groups here (the grid's group row has no −/+ there, §4.3). */
    onCollapse(group: string, collapsed: boolean): void;
    onCoverage(on: boolean): void;
    onReset(): void;
    onClose(): void;
}

/** The place of an arrow not offered (a move at the end of its run): the other arrow stays where it was. */
const MOVE_GAP = '<span class="tv-cp-move tv-cp-move-gap" aria-hidden="true"></span>';

function esc(text: string): string {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Folded to compare: lower case, no diacritics. */
function fold(text: string): string {
    return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/** The catalog's groups with their columns, the shown ones first in their order (§4.4). */
export function panelGroups(type: RowType, st: RowTypeState, query = ''): { group: ColumnGroup; columns: ColumnDef[]; shown: number; total: number }[] {
    const q = fold(query.trim());
    const order = new Map(st.columns.map((id, i) => [id, i]));
    const out: { group: ColumnGroup; columns: ColumnDef[]; shown: number; total: number }[] = [];
    for (const col of catalogColumns(type)) {
        let g = out.find(x => x.group === col.group);
        if (!g) { g = { group: col.group, columns: [], shown: 0, total: 0 }; out.push(g); }
        g.total++;
        if (order.has(col.id)) g.shown++;
        if (!q || fold(columnLabel(col)).includes(q)) g.columns.push(col);
    }
    for (const g of out) {
        g.columns.sort((a, b) => {
            const ia = order.get(a.id);
            const ib = order.get(b.id);
            if (ia !== undefined && ib !== undefined) return ia - ib;
            if (ia !== undefined) return -1;
            if (ib !== undefined) return 1;
            return 0;
        });
    }
    return q ? out.filter(g => g.columns.length > 0) : out;
}

let panelSeq = 0;

export class ColumnPanel {
    readonly el: HTMLElement;
    private readonly list: HTMLElement;
    private readonly count: HTMLElement;
    private readonly search: HTMLInputElement;
    private readonly coverage: HTMLInputElement;
    private readonly open = new Set<string>();
    private readonly uid = `tv-cp-${++panelSeq}`;

    constructor(private type: RowType, private st: RowTypeState, private readonly phone: boolean, private readonly handlers: ColumnPanelHandlers) {
        const el = document.createElement('div');
        el.className = `tv-colpanel${phone ? ' bottom-sheet tv-colpanel--sheet' : ''}`;
        el.setAttribute('role', 'dialog');
        el.setAttribute('aria-modal', phone ? 'true' : 'false');
        el.setAttribute('aria-labelledby', `${this.uid}-title`);
        el.tabIndex = -1;
        el.innerHTML = (phone ? '<div class="bottom-sheet-handle"></div>' : '')
            + '<div class="tv-cp-head">'
            + `<h2 class="tv-cp-title" id="${this.uid}-title">${esc(strings.table.columns)}</h2>`
            + '<span class="tv-cp-count"></span>'
            + `<button type="button" class="tv-cp-close" aria-label="${esc(strings.buttons.close)}">×</button>`
            + '</div>'
            + '<div class="tv-cp-search">'
            + `<input type="search" class="tv-cp-q" placeholder="${esc(strings.table.searchColumn)}" aria-label="${esc(strings.table.searchColumn)}" autocomplete="off" spellcheck="false">`
            + '</div>'
            + '<div class="tv-cp-list"></div>'
            + '<label class="tv-cp-cov"><input type="checkbox" role="switch" class="tv-cp-cov-input">'
            + `<span>${esc(strings.table.coverageRow)}</span></label>`
            + '<div class="tv-cp-foot">'
            + `<button type="button" class="link-button tv-cp-reset">${esc(strings.table.resetColumns)}</button>`
            + `<button type="button" class="primary tv-cp-done">${esc(strings.table.done)}</button>`
            + '</div>';
        this.el = el;
        this.list = el.querySelector('.tv-cp-list')!;
        this.count = el.querySelector('.tv-cp-count')!;
        this.search = el.querySelector('.tv-cp-q')!;
        this.coverage = el.querySelector('.tv-cp-cov-input')!;
        this.search.addEventListener('input', () => this.update());
        this.coverage.addEventListener('change', () => handlers.onCoverage(this.coverage.checked));
        el.querySelector('.tv-cp-close')!.addEventListener('click', () => handlers.onClose());
        el.querySelector('.tv-cp-done')!.addEventListener('click', () => handlers.onClose());
        el.querySelector('.tv-cp-reset')!.addEventListener('click', () => handlers.onReset());
        el.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                if (this.search.value && document.activeElement === this.search) { this.search.value = ''; this.update(); return; }
                handlers.onClose();
            }
        });
        this.list.addEventListener('change', (e) => {
            const box = (e.target as Element).closest<HTMLInputElement>('input.tv-cp-check');
            if (box) handlers.onShow(box.dataset.col!, box.checked);
        });
        this.list.addEventListener('click', (e) => {
            const t = e.target as Element;
            const fold = t.closest<HTMLElement>('.tv-cp-gtoggle');
            if (fold) {
                const g = fold.dataset.group!;
                if (this.open.has(g)) this.open.delete(g); else this.open.add(g);
                this.update();
                return;
            }
            const all = t.closest<HTMLElement>('.tv-cp-gall');
            if (all) { handlers.onGroupShown(all.dataset.group!, all.getAttribute('aria-pressed') !== 'true'); return; }
            const collapse = t.closest<HTMLElement>('.tv-cp-gcollapse');
            if (collapse) { handlers.onCollapse(collapse.dataset.group!, collapse.getAttribute('aria-pressed') !== 'true'); return; }
            const move = t.closest<HTMLElement>('.tv-cp-move[data-col]');
            if (move) {
                const col = move.dataset.col!;
                handlers.onMove(col, move.dataset.dir === 'up' ? -1 : 1);
                // A click need not focus a button (Safari): the arrows stay under the pointer and the keys;
                // at the end of its run the arrow is gone, the other one (or the checkbox) takes the focus.
                const item = this.list.querySelector<HTMLElement>(`.tv-cp-item[data-col="${col}"]`);
                (item?.querySelector<HTMLElement>(`.tv-cp-move[data-dir="${move.dataset.dir}"]`)
                    ?? item?.querySelector<HTMLElement>('.tv-cp-move[data-dir]')
                    ?? item?.querySelector<HTMLElement>('.tv-cp-check'))?.focus({ preventScroll: true });
            }
        });
        this.list.addEventListener('keydown', (e) => {
            if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
            const item = (e.target as Element).closest<HTMLElement>('.tv-cp-item[data-col]');
            if (!item) return;
            e.preventDefault();
            handlers.onMove(item.dataset.col!, e.key === 'ArrowUp' ? -1 : 1);
        });
        if (!phone) this.list.addEventListener('pointerdown', (e) => this.gripDrag(e));
        this.update();
    }

    /** The state changed (or another row type is shown): draw the list again, the focus kept. */
    update(type: RowType = this.type, st: RowTypeState = this.st): void {
        this.type = type;
        this.st = st;
        const active = document.activeElement as HTMLElement | null;
        const refocus = active && this.list.contains(active)
            ? (active.dataset.col ? `[data-col="${active.dataset.col}"]${active.dataset.dir ? `[data-dir="${active.dataset.dir}"]` : ''}.${[...active.classList].join('.')}`
                : active.dataset.group ? `[data-group="${active.dataset.group}"].${[...active.classList].join('.')}` : '')
            : '';
        const shown = new Set(st.columns);
        const lock = lockedColumn(type);
        const pinned = new Set(st.columns.slice(0, st.pinned));
        const all = catalogColumns(type);
        this.count.textContent = strings.table.columnsCount(st.columns.length, all.length);
        this.coverage.checked = st.coverageRow;
        const query = this.search.value;
        const groups = panelGroups(type, st, query);
        let html = '';
        for (const g of groups) {
            const label = groupLabel(g.group);
            const open = !!query || this.open.has(g.group);
            // "all" is pressed when what it shows is shown (the research group: its default set, §16.2).
            const allOn = g.group === 'research' && type === 'persons' ? groupAllColumns(type, g.group).every(c => shown.has(c.id)) : g.shown === g.total;
            const collapsed = st.collapsedGroups.includes(g.group);
            const listId = `${this.uid}-${g.group}`;
            html += `<section class="tv-cp-group${open ? ' is-open' : ''}" data-group="${esc(g.group)}">`
                + '<div class="tv-cp-ghead">'
                + `<button type="button" class="tv-cp-gtoggle" data-group="${esc(g.group)}" aria-expanded="${open}" aria-controls="${listId}">`
                + `<span class="tv-cp-chev" aria-hidden="true">${open ? '▾' : '▸'}</span>`
                + `<span class="tv-cp-gname">${esc(label)}</span>`
                + `<span class="tv-cp-gcount">${esc(strings.table.columnsCount(g.shown, g.total))}</span></button>`
                + (this.phone && g.shown > 0
                    ? `<button type="button" class="tv-cp-gcollapse" data-group="${esc(g.group)}" aria-pressed="${collapsed}"`
                        + ` aria-label="${esc(collapsed ? strings.table.expandGroup(label) : strings.table.collapseGroup(label))}">${collapsed ? '+' : '−'}</button>`
                    : '')
                + (open ? `<button type="button" class="tv-cp-gall" data-group="${esc(g.group)}" aria-pressed="${allOn}"`
                    + ` aria-label="${esc(strings.table.allOf(label))}">${esc(strings.table.all)}</button>` : '')
                + '</div>';
            if (open) {
                html += `<ul class="tv-cp-items" id="${listId}" role="list">`;
                for (const col of g.columns) {
                    const on = shown.has(col.id);
                    const locked = col.id === lock;
                    const name = columnLabel(col);
                    const up = on && canMoveColumn(type, st, col.id, -1);
                    const down = on && canMoveColumn(type, st, col.id, 1);
                    html += `<li class="tv-cp-item${on ? ' is-on' : ''}" data-col="${esc(col.id)}">`
                        + `<label class="tv-cp-label"><input type="checkbox" class="tv-cp-check" data-col="${esc(col.id)}"${on ? ' checked' : ''}${locked ? ' disabled' : ''}>`
                        + `<span class="tv-cp-name">${esc(name)}</span></label>`
                        + (pinned.has(col.id) ? `<span class="tv-cp-note">${esc(strings.table.pinnedLabel)}</span>` : '')
                        // Only a move that can be made is offered (spec 082 K2.1); a lone arrow keeps its place.
                        + (up || down
                            ? (up ? `<button type="button" class="tv-cp-move" data-col="${esc(col.id)}" data-dir="up" aria-label="${esc(`${strings.table.moveUp}: ${name}`)}">↑</button>` : MOVE_GAP)
                            + (down ? `<button type="button" class="tv-cp-move" data-col="${esc(col.id)}" data-dir="down" aria-label="${esc(`${strings.table.moveDown}: ${name}`)}">↓</button>` : MOVE_GAP)
                            : '')
                        + ((up || down) && !this.phone ? '<span class="tv-cp-grip" aria-hidden="true">⠿</span>' : '')
                        + '</li>';
                }
                html += '</ul>';
            }
            html += '</section>';
        }
        if (!groups.length) html = `<p class="tv-cp-empty">${esc(strings.table.noColumnMatch)}</p>`;
        this.list.innerHTML = html;
        if (refocus) this.list.querySelector<HTMLElement>(refocus)?.focus({ preventScroll: true });
    }

    /** Where the focus goes when the panel opens: the search on a computer, the panel itself on a phone (no keyboard over the list). */
    focusFirst(): void {
        (this.phone ? this.el : this.search).focus({ preventScroll: true });
    }

    /** Drag a checked column by its grip within its group (§4.4). */
    private gripDrag(e: PointerEvent): void {
        const grip = (e.target as Element).closest('.tv-cp-grip');
        const item = grip?.closest<HTMLElement>('.tv-cp-item[data-col]');
        if (!item || e.button !== 0) return;
        e.preventDefault();
        const ul = item.parentElement!;
        const items = [...ul.querySelectorAll<HTMLElement>('.tv-cp-item.is-on')];
        const line = document.createElement('div');
        line.className = 'tv-cp-dropline';
        ul.appendChild(line);
        item.classList.add('is-drag-source');
        let target: HTMLElement | null = null;
        const onMove = (ev: PointerEvent): void => {
            // Its new place: how many of the other checked items have their middle above the pointer.
            const k = items.filter(it => it !== item && it.getBoundingClientRect().top + it.offsetHeight / 2 < ev.clientY).length;
            target = items[k] ?? null;
            if (!target) return;
            const r = target.getBoundingClientRect();
            const up = k < items.indexOf(item);
            line.style.top = `${(up ? r.top : r.bottom) - ul.getBoundingClientRect().top - 1}px`;
        };
        const end = (cancel: boolean): void => {
            window.removeEventListener('pointermove', onMove, true);
            window.removeEventListener('pointerup', onUp, true);
            window.removeEventListener('keydown', onKey, true);
            line.remove();
            item.classList.remove('is-drag-source');
            if (!cancel && target && target !== item) this.handlers.onMoveTo(item.dataset.col!, target.dataset.col!);
        };
        const onUp = (): void => end(false);
        const onKey = (ev: KeyboardEvent): void => { if (ev.key === 'Escape') { ev.stopPropagation(); end(true); } };
        window.addEventListener('pointermove', onMove, true);
        window.addEventListener('pointerup', onUp, true);
        window.addEventListener('keydown', onKey, true);
    }
}
