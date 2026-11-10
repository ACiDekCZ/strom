/**
 * Table view (spec 073 §8): the filter's controls in the bar.
 *
 * The search field (§8.3) in the bar's search slot; the quick chips and the
 * column filters' chips in the bar's second row (§8.1), with "More filters"
 * for what does not fit (measured like the toolbar: active chips first, the
 * rest in the fixed order) and "Clear filters" at the right. On a phone the
 * row is not there: a "Filters (n)" button opens a sheet (8h). The forms of
 * a column filter (8d) and of the Family line and Generation chips are built
 * here too; table-ui.ts shows them in a panel or a sheet and applies them.
 */

import { strings } from '../../strings.js';
import { columnLabel, type ColumnDef } from './table-columns.js';
import { ROW_KEY, type RowType, type TableModel } from './table-model.js';
import {
    activeFilterCount, availableChips, CHECK_CHIPS, chipItem, chipLabel, columnItemLabel, columnItems, columnValues, filterKindOf,
    generationSpan, rodChoices, type ChipFilter, type ChipId, type ColumnFilter, type TableFilter,
} from './table-filter.js';
import { closeHeadMenu, openHeadMenu, type HeadMenuEntry } from './table-headmenu.js';

function esc(text: string): string {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** The chips with a choice of their own (a panel instead of a toggle). */
export const CHOICE_CHIPS: readonly ChipId[] = ['rod', 'gen'];

/** The search's delay after a key (§8.3). */
export const SEARCH_DELAY_MS = 150;

/** The phone's sheet shows this many quick chips before "More (n)" (8h). */
const SHEET_FIRST = 7;

export interface FilterBarState {
    model: TableModel;
    type: RowType;
    filter: TableFilter;
    search: string;
    /** The rows that pass now (the matches beside the search, "Show n people"). */
    shown: number;
    /** The checks still run: the chips on findings wait (§13i). */
    checking: boolean;
    phone: boolean;
}

export interface FilterBarHandlers {
    onSearch(text: string): void;
    /** A chip without a choice: on or off. */
    onChip(chip: ChipId, on: boolean): void;
    /** Family line or Generation: their panel. */
    onChoiceChip(chip: ChipId, anchor: HTMLElement): void;
    /** A column filter's chip: its form. */
    onEditColumn(col: string, anchor: HTMLElement): void;
    onRemoveColumn(col: string): void;
    onClear(): void;
    /** The phone's Filters button. */
    onSheet(): void;
}

/** The participant filter's chip (§14.1: "Godparent: {name} ×"), when it is on. */
function participantChipHtml(model: TableModel, type: RowType, filter: TableFilter): string {
    const item = type === 'events' ? chipItem(filter, 'participant') : null;
    if (!item) return '';
    const label = chipLabel(model, item, 'participant');
    return `<span class="tv-chip tv-chip--col tv-chip--part is-active" data-partchip>`
        + `<span class="tv-chip-text">${esc(label)}</span>`
        + `<button type="button" class="tv-chip-x" data-xchip="participant" aria-label="${esc(strings.table.removeFilter(label))}">×</button></span>`;
}

/** The bar's filter controls: search, the chips' row and the phone's Filters button. */
export class FilterBar {
    private readonly input: HTMLInputElement;
    private readonly matches: HTMLElement;
    private readonly row: HTMLElement;
    private readonly sheetBtn: HTMLButtonElement;
    private state: FilterBarState | null = null;
    private timer = 0;
    private readonly ro: ResizeObserver | null;
    private width = 0;
    /** The chips the row could not show (they are in "More filters"). */
    private hidden: ChipId[] = [];

    constructor(bar: HTMLElement, private readonly handlers: FilterBarHandlers) {
        const slot = bar.querySelector<HTMLElement>('.tv-slot-search')!;
        slot.innerHTML = '<div class="tv-search">'
            + `<input type="search" class="tv-search-q" placeholder="${esc(strings.table.search)}" aria-label="${esc(strings.table.search)}"`
            + ' autocomplete="off" spellcheck="false" enterkeyhint="search">'
            + '<span class="tv-matches" aria-live="polite"></span></div>';
        this.input = slot.querySelector('.tv-search-q')!;
        this.matches = slot.querySelector('.tv-matches')!;
        this.input.addEventListener('input', () => {
            clearTimeout(this.timer);
            this.timer = window.setTimeout(() => handlers.onSearch(this.input.value), SEARCH_DELAY_MS);
        });
        this.input.addEventListener('keydown', (e) => {
            if (e.key !== 'Escape' || !this.input.value) return;
            e.preventDefault();
            e.stopPropagation();
            clearTimeout(this.timer);
            this.input.value = '';
            handlers.onSearch('');
        });
        // The phone's Filters button: on its own line with the search (CSS).
        this.sheetBtn = document.createElement('button');
        this.sheetBtn.type = 'button';
        this.sheetBtn.className = 'tv-filters-btn';
        this.sheetBtn.setAttribute('aria-haspopup', 'dialog');
        this.sheetBtn.addEventListener('click', () => handlers.onSheet());
        slot.after(this.sheetBtn);

        this.row = bar.querySelector<HTMLElement>('.tv-chips')!;
        this.row.setAttribute('role', 'toolbar');
        this.row.setAttribute('aria-label', strings.table.filters);
        this.row.addEventListener('click', (e) => this.onRowClick(e));
        this.ro = typeof ResizeObserver === 'function'
            ? new ResizeObserver(() => {
                const w = this.row.clientWidth;
                if (w && w !== this.width) { this.width = w; this.fit(); }
            })
            : null;
        this.ro?.observe(this.row);
    }

    destroy(): void {
        clearTimeout(this.timer);
        this.ro?.disconnect();
    }

    /** Focus the search field (Ctrl+F in the table). */
    focusSearch(): void {
        this.input.focus();
        this.input.select();
    }

    update(state: FilterBarState): void {
        this.state = state;
        const { model, type, filter } = state;
        if (document.activeElement !== this.input && this.input.value !== state.search) this.input.value = state.search;
        const q = state.search.trim();
        this.matches.textContent = q.length >= 2 ? strings.table.matches(state.shown) : '';
        const n = activeFilterCount(model, type, filter);
        this.sheetBtn.textContent = n ? `${strings.table.filters} (${n})` : strings.table.filters;
        this.sheetBtn.classList.toggle('is-active', n > 0);

        const chips = availableChips(model, type);
        const cols = columnItems(filter);
        this.row.hidden = state.phone || (!chips.length && !cols.length);
        if (this.row.hidden) { this.row.innerHTML = ''; return; }
        let html = '';
        for (const chip of chips) {
            const item = chipItem(filter, chip);
            const waits = state.checking && CHECK_CHIPS.includes(chip);
            const choice = CHOICE_CHIPS.includes(chip);
            html += `<button type="button" class="tv-chip${item ? ' is-active' : ''}" data-chip="${chip}" aria-pressed="${!!item}"`
                + (waits ? ` aria-disabled="true" title="${esc(strings.table.checksWait)}"` : '')
                + (choice ? ' aria-haspopup="dialog"' : '')
                + `>${item ? '✓ ' : ''}${esc(chipLabel(model, item, chip))}${choice ? ' ▾' : ''}</button>`;
        }
        html += participantChipHtml(model, type, filter);
        for (const c of cols) {
            const label = columnItemLabel(type, c);
            html += `<span class="tv-chip tv-chip--col is-active" data-colchip="${esc(c.col)}">`
                + `<button type="button" class="tv-chip-edit" data-col="${esc(c.col)}" aria-haspopup="dialog" aria-label="${esc(strings.table.filterOf(label))}">${esc(label)}</button>`
                + `<button type="button" class="tv-chip-x" data-x="${esc(c.col)}" aria-label="${esc(strings.table.removeFilter(label))}">×</button></span>`;
        }
        html += '<button type="button" class="tv-chip tv-chip-more" aria-haspopup="menu" hidden></button>';
        if (n) html += `<button type="button" class="tv-chips-clear">${esc(strings.table.clearFilters)}</button>`;
        this.row.innerHTML = html;
        this.width = this.row.clientWidth;
        this.fit();
    }

    /**
     * Fit the chips into the row: everything in the fixed order when it fits;
     * else the active chips first and the others from the end into "More
     * filters" until the row fits.
     */
    private fit(): void {
        const st = this.state;
        if (!st || this.row.hidden) return;
        const quick = [...this.row.querySelectorAll<HTMLElement>('.tv-chip[data-chip]')];
        const more = this.row.querySelector<HTMLElement>('.tv-chip-more')!;
        for (const c of quick) { c.hidden = false; c.style.order = ''; }
        more.hidden = true;
        this.hidden = [];
        const over = (): boolean => this.row.scrollWidth > this.row.clientWidth + 1;
        if (!over()) return;
        // Active chips go first, column chips after them, the rest keeps its order.
        quick.forEach((c, i) => { c.style.order = String(c.classList.contains('is-active') ? i : 100 + i); });
        for (const c of this.row.querySelectorAll<HTMLElement>('.tv-chip--col')) c.style.order = '50';
        more.style.order = '500';
        more.hidden = false;
        const inactive = quick.filter(c => !c.classList.contains('is-active'));
        const label = (): void => {
            const act = this.hidden.filter(id => !!chipItem(st.filter, id)).length;
            more.textContent = `${strings.table.moreFilters}${act ? ` (${act})` : ''} ▾`;
        };
        label();
        for (let i = inactive.length - 1; i >= 0 && over(); i--) {
            inactive[i].hidden = true;
            this.hidden.unshift(inactive[i].dataset.chip as ChipId);
            label();
        }
        if (!this.hidden.length) more.hidden = true;
    }

    private onRowClick(e: MouseEvent): void {
        const st = this.state;
        if (!st) return;
        const t = e.target as Element;
        if (t.closest('.tv-chips-clear')) { this.handlers.onClear(); return; }
        const xc = t.closest<HTMLElement>('[data-xchip]');
        if (xc) { this.handlers.onChip(xc.dataset.xchip as ChipId, false); return; }
        const x = t.closest<HTMLElement>('[data-x]');
        if (x) { this.handlers.onRemoveColumn(x.dataset.x!); return; }
        const edit = t.closest<HTMLElement>('.tv-chip-edit[data-col]');
        if (edit) { this.handlers.onEditColumn(edit.dataset.col!, edit); return; }
        const more = t.closest<HTMLElement>('.tv-chip-more');
        if (more) { this.openMore(more); return; }
        const btn = t.closest<HTMLElement>('.tv-chip[data-chip]');
        if (!btn || btn.getAttribute('aria-disabled') === 'true') return;
        const chip = btn.dataset.chip as ChipId;
        if (CHOICE_CHIPS.includes(chip)) this.handlers.onChoiceChip(chip, btn);
        else this.handlers.onChip(chip, btn.getAttribute('aria-pressed') !== 'true');
    }

    /** "More filters": the chips the row could not show, with a check by the active ones. */
    private openMore(anchor: HTMLElement): void {
        const st = this.state;
        if (!st) return;
        const entries: HeadMenuEntry[] = this.hidden.map(chip => {
            const item = chipItem(st.filter, chip);
            const choice = CHOICE_CHIPS.includes(chip);
            return {
                id: chip, label: chipLabel(st.model, item, chip), icon: item ? '✓' : '',
                hint: choice ? '›' : undefined,
                disabled: st.checking && CHECK_CHIPS.includes(chip),
                run: () => (choice ? this.handlers.onChoiceChip(chip, anchor) : this.handlers.onChip(chip, !item)),
            };
        });
        openHeadMenu(anchor, strings.table.moreFilters, '', entries);
    }
}

// ---------------------------------------------------------------------------
// Forms (8d): a column filter, the Family line and Generation chips

export interface FilterForm {
    el: HTMLElement;
    /** The filter as the form says it now. */
    read(): ColumnFilter;
}

function numberOr(input: HTMLInputElement): number | undefined {
    const v = input.value.trim();
    if (!v) return undefined;
    const n = Number(v.replace(',', '.'));
    return Number.isFinite(n) ? n : undefined;
}

let formSeq = 0;

/** The form of a column's filter (§8.2): by the column's kind, always with only empty / only filled. */
export function columnFilterForm(model: TableModel, type: RowType, col: ColumnDef, item: ColumnFilter | null): FilterForm {
    const t = strings.table;
    const kind = filterKindOf(col);
    const uid = `tv-ff-${++formSeq}`;
    const el = document.createElement('div');
    el.className = 'tv-ff';
    let html = '';
    if (kind === 'text') {
        html += '<div class="tv-ff-line">'
            + `<select class="tv-ff-match" aria-label="${esc(columnLabel(col))}">`
            + `<option value="contains"${item?.match !== 'starts' ? ' selected' : ''}>${esc(t.matchContains)}</option>`
            + `<option value="starts"${item?.match === 'starts' ? ' selected' : ''}>${esc(t.matchStarts)}</option></select>`
            + `<input type="text" class="tv-ff-text" value="${esc(item?.text ?? '')}" aria-label="${esc(t.filterValue)}" autocomplete="off" spellcheck="false">`
            + '</div>';
    } else if (kind === 'range') {
        const lead = col.kind === 'date' ? `<span class="tv-ff-lead">${esc(t.rangeYears)}</span>` : '';
        html += `<div class="tv-ff-line">${lead}`
            + `<label class="tv-ff-range"><span>${esc(t.rangeFrom)}</span><input type="number" inputmode="numeric" class="tv-ff-from" value="${item?.from ?? ''}"></label>`
            + `<label class="tv-ff-range"><span>${esc(t.rangeTo)}</span><input type="number" inputmode="numeric" class="tv-ff-to" value="${item?.to ?? ''}"></label>`
            + '</div>';
    } else {
        const values = columnValues(model, type, col);
        html += `<div class="tv-ff-values" role="group" aria-label="${esc(columnLabel(col))}">`
            + values.map(v => `<label class="tv-ff-check"><input type="checkbox" class="tv-ff-value" value="${esc(v.value)}"`
                + `${item?.values?.includes(v.value) ? ' checked' : ''}><span>${esc(v.label)}</span></label>`).join('')
            + '</div>';
    }
    html += '<div class="tv-ff-sep" role="separator"></div>'
        + `<label class="tv-ff-check"><input type="checkbox" class="tv-ff-empty" name="${uid}"${item?.empty ? ' checked' : ''}><span>${esc(t.onlyEmpty)}</span></label>`
        + `<label class="tv-ff-check"><input type="checkbox" class="tv-ff-filled" name="${uid}"${item?.filled ? ' checked' : ''}><span>${esc(t.onlyFilled)}</span></label>`;
    el.innerHTML = html;
    const empty = el.querySelector<HTMLInputElement>('.tv-ff-empty')!;
    const filled = el.querySelector<HTMLInputElement>('.tv-ff-filled')!;
    // Only empty and only filled exclude each other.
    empty.addEventListener('change', () => { if (empty.checked) filled.checked = false; });
    filled.addEventListener('change', () => { if (filled.checked) empty.checked = false; });
    return {
        el,
        read(): ColumnFilter {
            const out: ColumnFilter = { col: col.id, kind: col.kind };
            if (kind === 'text') {
                const text = el.querySelector<HTMLInputElement>('.tv-ff-text')!.value.trim();
                if (text) { out.text = text; out.match = el.querySelector<HTMLSelectElement>('.tv-ff-match')!.value === 'starts' ? 'starts' : 'contains'; }
            } else if (kind === 'range') {
                const from = numberOr(el.querySelector<HTMLInputElement>('.tv-ff-from')!);
                const to = numberOr(el.querySelector<HTMLInputElement>('.tv-ff-to')!);
                if (from !== undefined) out.from = from;
                if (to !== undefined) out.to = to;
            } else {
                const values = [...el.querySelectorAll<HTMLInputElement>('.tv-ff-value:checked')].map(i => i.value);
                if (values.length) out.values = values;
            }
            if (empty.checked) out.empty = true;
            if (filled.checked) out.filled = true;
            return out;
        },
    };
}

export interface ChipForm {
    el: HTMLElement;
    read(): Omit<ChipFilter, 'chip'> | null;
}

/** The Family line chip's choice (the tree's lines with their people) or the Generation chip's range. */
export function chipChoiceForm(model: TableModel, chip: ChipId, item: ChipFilter | null, onChange?: () => void): ChipForm {
    const t = strings.table;
    const el = document.createElement('div');
    el.className = 'tv-ff';
    if (chip === 'rod') {
        const choices = rodChoices(model);
        el.innerHTML = `<div class="tv-ff-values" role="group" aria-label="${esc(t.chip.rod)}">`
            + choices.map(c => `<label class="tv-ff-check"><input type="checkbox" class="tv-ff-value" value="${esc(c.id)}"`
                + `${item?.values?.includes(c.id) ? ' checked' : ''}><span>${esc(c.label)}</span><span class="tv-ff-n">${c.n}</span></label>`).join('')
            + '</div>';
        if (onChange) el.addEventListener('change', onChange);
        return {
            el,
            read: () => {
                const values = [...el.querySelectorAll<HTMLInputElement>('.tv-ff-value:checked')].map(i => i.value);
                return values.length ? { values } : null;
            },
        };
    }
    const span = generationSpan(model) ?? { min: 1, max: 1 };
    const opts = (sel: number | undefined): string => {
        let o = `<option value=""${sel === undefined ? ' selected' : ''}>–</option>`;
        for (let g = span.min; g <= span.max; g++) o += `<option value="${g}"${sel === g ? ' selected' : ''}>${g}</option>`;
        return o;
    };
    el.innerHTML = '<div class="tv-ff-line">'
        + `<label class="tv-ff-range"><span>${esc(t.rangeFrom)}</span><select class="tv-ff-from" aria-label="${esc(`${t.chip.gen} ${t.rangeFrom}`)}">${opts(item?.from)}</select></label>`
        + `<label class="tv-ff-range"><span>${esc(t.rangeTo)}</span><select class="tv-ff-to" aria-label="${esc(`${t.chip.gen} ${t.rangeTo}`)}">${opts(item?.to)}</select></label>`
        + '</div>';
    if (onChange) el.addEventListener('change', onChange);
    return {
        el,
        read: () => {
            const f = el.querySelector<HTMLSelectElement>('.tv-ff-from')!.value;
            const to = el.querySelector<HTMLSelectElement>('.tv-ff-to')!.value;
            let from = f ? Number(f) : undefined;
            let upto = to ? Number(to) : undefined;
            if (from !== undefined && upto !== undefined && from > upto) [from, upto] = [upto, from];
            if (from === undefined && upto === undefined) return null;
            return { ...(from !== undefined ? { from } : {}), ...(upto !== undefined ? { to: upto } : {}) };
        },
    };
}

// ---------------------------------------------------------------------------
// The panel under a chip or a head (8d)

let openPanel: { el: HTMLElement; close(focusBack: boolean): void } | null = null;

export function closeFilterPanel(): void {
    openPanel?.close(false);
}

/**
 * A form in a panel under its anchor: Cancel · Apply (Enter applies, Escape
 * closes); the focus goes back to the anchor.
 */
/** How a panel differs from a filter's (the view name §9.3, Export §11.1). */
export interface PanelOptions {
    /** The primary button's text (default Apply). */
    applyLabel?: string;
    /** The dialog's accessible name (default "Filter: {title}"). */
    ariaLabel?: string;
    /** An extra class of the panel. */
    cls?: string;
    /** No Cancel button. */
    noCancel?: boolean;
    /** False keeps the panel open (an empty name). */
    validate?: () => boolean;
}

export function openFilterPanel(anchor: HTMLElement, title: string, form: HTMLElement, apply: () => void, opts: PanelOptions = {}): HTMLElement {
    closeFilterPanel();
    closeHeadMenu();
    const t = strings.table;
    const el = document.createElement('div');
    el.className = 'tv-fpanel' + (opts.cls ? ` ${opts.cls}` : '');
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', opts.ariaLabel ?? strings.table.filterOf(title));
    el.innerHTML = title ? `<div class="tv-fpanel-title">${esc(title)}</div>` : '';
    el.appendChild(form);
    const foot = document.createElement('div');
    foot.className = 'tv-fpanel-foot';
    foot.innerHTML = (opts.noCancel ? '' : `<button type="button" class="tv-fpanel-cancel">${esc(t.cancel)}</button>`)
        + `<button type="button" class="tv-fpanel-apply">${esc(opts.applyLabel ?? t.apply)}</button>`;
    el.appendChild(foot);
    document.body.appendChild(el);

    const r = anchor.getBoundingClientRect();
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const left = Math.max(8, Math.min(r.left, window.innerWidth - w - 8));
    const below = r.bottom + 4;
    const top = below + h > window.innerHeight - 8 ? Math.max(8, r.top - h - 4) : below;
    el.style.left = `${Math.round(left)}px`;
    el.style.top = `${Math.round(top)}px`;

    const close = (focusBack: boolean): void => {
        if (openPanel?.el !== el) return;
        openPanel = null;
        el.remove();
        document.removeEventListener('pointerdown', onOutside, true);
        window.removeEventListener('resize', onResize);
        if (focusBack && anchor.isConnected) anchor.focus({ preventScroll: true });
    };
    const onOutside = (e: PointerEvent): void => { if (!el.contains(e.target as Node)) close(false); };
    const onResize = (): void => close(false);
    const done = (): void => {
        if (opts.validate && !opts.validate()) return;
        close(true);
        apply();
    };
    foot.querySelector('.tv-fpanel-cancel')?.addEventListener('click', () => close(true));
    foot.querySelector('.tv-fpanel-apply')!.addEventListener('click', done);
    el.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(true); }
        else if (e.key === 'Enter' && !(e.target as Element).closest('button, select')) { e.preventDefault(); done(); }
    });
    setTimeout(() => document.addEventListener('pointerdown', onOutside, true), 0);
    window.addEventListener('resize', onResize);
    openPanel = { el, close };
    const first = el.querySelector<HTMLElement>('input:not([type="checkbox"]), select, input') ?? el.querySelector<HTMLElement>('.tv-fpanel-apply');
    first?.focus({ preventScroll: true });
    if (opts.validate && first instanceof HTMLInputElement) first.select();
    return el;
}

// ---------------------------------------------------------------------------
// The phone's Filters sheet (8h)

export interface FilterSheetHandlers {
    onChip(chip: ChipId, on: boolean): void;
    onChoice(chip: ChipId, choice: Omit<ChipFilter, 'chip'> | null): void;
    onRemoveColumn(col: string): void;
    onClear(): void;
    onClose(): void;
}

/**
 * The sheet: the quick chips as 48 px rows with a check (the first seven and
 * the active ones, "More (n)" for the rest), Family line and Generation as a
 * page of the sheet, the column filters with ×, "Clear filters" and "Show n
 * people" at the bottom. Every change applies at once.
 */
export class FilterSheet {
    readonly el: HTMLElement;
    private readonly body: HTMLElement;
    private readonly title: HTMLElement;
    private readonly back: HTMLButtonElement;
    private readonly clear: HTMLButtonElement;
    private readonly show: HTMLButtonElement;
    private state: FilterBarState | null = null;
    private page: 'main' | 'rod' | 'gen' = 'main';
    private all = false;
    private readonly uid = `tv-fs-${++formSeq}`;

    constructor(private readonly handlers: FilterSheetHandlers) {
        const el = document.createElement('div');
        el.className = 'tv-colpanel tv-colpanel--sheet bottom-sheet tv-fsheet';
        el.setAttribute('role', 'dialog');
        el.setAttribute('aria-modal', 'true');
        el.setAttribute('aria-labelledby', `${this.uid}-title`);
        el.tabIndex = -1;
        el.innerHTML = '<div class="bottom-sheet-handle"></div>'
            + '<div class="tv-cp-head">'
            + `<button type="button" class="tv-fs-back" aria-label="${esc(strings.contextMenu.back)}" hidden>‹</button>`
            + `<h2 class="tv-cp-title" id="${this.uid}-title"></h2>`
            + `<button type="button" class="tv-cp-close" aria-label="${esc(strings.buttons.close)}">×</button>`
            + '</div>'
            + '<div class="tv-cp-list tv-fs-body"></div>'
            + '<div class="tv-cp-foot">'
            + `<button type="button" class="link-button tv-cp-reset tv-fs-clear">${esc(strings.table.clearFilters)}</button>`
            + '<button type="button" class="primary tv-cp-done tv-fs-show"></button>'
            + '</div>';
        this.el = el;
        this.body = el.querySelector('.tv-fs-body')!;
        this.title = el.querySelector('.tv-cp-title')!;
        this.back = el.querySelector('.tv-fs-back')!;
        this.clear = el.querySelector('.tv-fs-clear')!;
        this.show = el.querySelector('.tv-fs-show')!;
        el.querySelector('.tv-cp-close')!.addEventListener('click', () => handlers.onClose());
        this.show.addEventListener('click', () => handlers.onClose());
        this.clear.addEventListener('click', () => handlers.onClear());
        this.back.addEventListener('click', () => { this.page = 'main'; this.render(); this.el.querySelector<HTMLElement>('.tv-fs-row')?.focus(); });
        el.addEventListener('keydown', (e) => {
            if (e.key !== 'Escape') return;
            e.preventDefault();
            e.stopPropagation();
            if (this.page !== 'main') { this.page = 'main'; this.render(); } else handlers.onClose();
        });
        this.body.addEventListener('change', (e) => {
            const input = e.target as HTMLInputElement;
            const chip = input.dataset.chip as ChipId | undefined;
            if (chip) this.handlers.onChip(chip, input.checked);
        });
        this.body.addEventListener('click', (e) => {
            const t = e.target as Element;
            const page = t.closest<HTMLElement>('[data-page]');
            if (page) { this.page = page.dataset.page as 'rod' | 'gen'; this.render(); this.body.querySelector<HTMLElement>('input, select')?.focus(); return; }
            if (t.closest('.tv-fs-more')) { this.all = true; this.render(); return; }
            const xc = t.closest<HTMLElement>('[data-xchip]');
            if (xc) { this.handlers.onChip(xc.dataset.xchip as ChipId, false); return; }
            const x = t.closest<HTMLElement>('[data-x]');
            if (x) this.handlers.onRemoveColumn(x.dataset.x!);
        });
    }

    focusFirst(): void {
        (this.body.querySelector<HTMLElement>('input, button') ?? this.el).focus({ preventScroll: true });
    }

    update(state: FilterBarState): void {
        this.state = state;
        // A change from the page keeps its controls (and their focus); the rest is drawn again.
        if (this.page !== 'main' && this.body.contains(document.activeElement)) { this.foot(); return; }
        this.render();
    }

    private foot(): void {
        const st = this.state!;
        this.show.textContent = strings.table.showN[ROW_KEY[st.type]](st.shown);
        this.clear.hidden = !activeFilterCount(st.model, st.type, st.filter);
    }

    private render(): void {
        const st = this.state;
        if (!st) return;
        const t = strings.table;
        this.foot();
        this.back.hidden = this.page === 'main';
        if (this.page !== 'main') {
            const chip = this.page;
            this.title.textContent = t.chip[chip];
            const form = chipChoiceForm(st.model, chip, chipItem(st.filter, chip), () => this.handlers.onChoice(chip, form.read()));
            this.body.innerHTML = '';
            this.body.appendChild(form.el);
            return;
        }
        this.title.textContent = t.filters;
        const chips = availableChips(st.model, st.type);
        const shown = this.all ? chips : chips.filter((c, i) => i < SHEET_FIRST || !!chipItem(st.filter, c));
        const rest = chips.length - shown.length;
        let html = chips.length ? `<div class="tv-fs-section">${esc(t.quickFilters)}</div>` : '';
        for (const chip of shown) {
            const item = chipItem(st.filter, chip);
            if (CHOICE_CHIPS.includes(chip)) {
                html += `<button type="button" class="tv-fs-row tv-fs-page${item ? ' is-active' : ''}" data-page="${chip}">`
                    + `<span class="tv-fs-label">${esc(chipLabel(st.model, item, chip))}</span><span class="tv-fs-chev" aria-hidden="true">›</span></button>`;
                continue;
            }
            const waits = st.checking && CHECK_CHIPS.includes(chip);
            html += `<label class="tv-fs-row"><input type="checkbox" class="tv-cp-check" data-chip="${chip}"${item ? ' checked' : ''}${waits ? ' disabled' : ''}>`
                + `<span class="tv-fs-label">${esc(t.chip[chip])}</span>${waits ? `<span class="tv-cp-note">${esc(t.checksWait)}</span>` : ''}</label>`;
        }
        if (rest > 0) html += `<button type="button" class="tv-fs-row tv-fs-more">${esc(t.moreN(rest))}</button>`;
        const part = st.type === 'events' ? chipItem(st.filter, 'participant') : null;
        if (part) {
            const label = chipLabel(st.model, part, 'participant');
            html += `<div class="tv-fs-row tv-fs-part"><span class="tv-fs-label">${esc(label)}</span>`
                + `<button type="button" class="tv-fs-x" data-xchip="participant" aria-label="${esc(t.removeFilter(label))}">×</button></div>`;
        }
        const cols = columnItems(st.filter);
        if (cols.length) {
            html += `<div class="tv-fs-section">${esc(t.inColumns)}</div>`;
            for (const c of cols) {
                const label = columnItemLabel(st.type, c);
                html += `<div class="tv-fs-row"><span class="tv-fs-label">${esc(label)}</span>`
                    + `<button type="button" class="tv-fs-x" data-x="${esc(c.col)}" aria-label="${esc(t.removeFilter(label))}">×</button></div>`;
            }
        }
        this.body.innerHTML = html;
    }
}
