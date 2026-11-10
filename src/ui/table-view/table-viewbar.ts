/**
 * Table view (spec 073 §9.2, §9.3, §11.1): the bar's view picker and Export.
 *
 * "View  {name} ▾" opens the list of views; once the shown state differs
 * from the open view: "● changed", Save (a saved view only), Save as new and
 * the Discard changes link. A read-only tree keeps the view picker and
 * Discard; nothing is saved into the tree. On a phone the button alone (a
 * dot in it when changed); its sheet carries the rest (table-ui.ts).
 *
 * The forms of the view name (§9.3) and of the export (§11.1, §11.3) are built
 * here; table-ui.ts shows them as a panel or a sheet.
 */

import { strings } from '../../strings.js';
import { ROW_KEY, type RowType } from './table-model.js';

export interface ViewBarState {
    name: string;
    builtin: boolean;
    changed: boolean;
    readOnly: boolean;
}

export interface ViewBarHandlers {
    onList(anchor: HTMLElement): void;
    onSave(): void;
    onSaveAs(anchor: HTMLElement): void;
    onDiscard(): void;
    /** "● changed" of a built-in view: why there is no Save. */
    onBuiltinNote(anchor: HTMLElement): void;
}

function esc(text: string): string {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** The view picker in the bar's `.tv-slot-view`. */
export class ViewBar {
    private readonly slot: HTMLElement;
    private readonly btn: HTMLButtonElement;
    private readonly changed: HTMLButtonElement;
    private readonly save: HTMLButtonElement;
    private readonly saveAs: HTMLButtonElement;
    private readonly discard: HTMLButtonElement;
    private last = '';

    constructor(slot: HTMLElement, private readonly handlers: ViewBarHandlers) {
        this.slot = slot;
        const t = strings.table;
        slot.innerHTML = `<span class="tv-view-label" aria-hidden="true">${esc(t.view)}</span>`
            + '<button type="button" class="tv-view-btn" aria-haspopup="menu">'
            + '<span class="tv-view-name"></span><span class="tv-view-dot" aria-hidden="true" hidden>●</span><span class="tv-view-caret" aria-hidden="true">▾</span></button>'
            + `<button type="button" class="tv-view-changed" hidden>● ${esc(t.changed)}</button>`
            + `<button type="button" class="tv-view-act tv-view-save" hidden>${esc(t.save)}</button>`
            + `<button type="button" class="tv-view-act tv-view-saveas" hidden>${esc(t.saveAs)}</button>`
            + `<button type="button" class="tv-view-discard" hidden>${esc(t.discard)}</button>`;
        this.btn = slot.querySelector('.tv-view-btn')!;
        this.changed = slot.querySelector('.tv-view-changed')!;
        this.save = slot.querySelector('.tv-view-save')!;
        this.saveAs = slot.querySelector('.tv-view-saveas')!;
        this.discard = slot.querySelector('.tv-view-discard')!;
        this.btn.addEventListener('click', () => this.handlers.onList(this.btn));
        this.changed.addEventListener('click', () => this.handlers.onBuiltinNote(this.changed));
        this.save.addEventListener('click', () => this.handlers.onSave());
        this.saveAs.addEventListener('click', () => this.handlers.onSaveAs(this.saveAs));
        this.discard.addEventListener('click', () => this.handlers.onDiscard());
    }

    get button(): HTMLButtonElement {
        return this.btn;
    }

    update(s: ViewBarState): void {
        const key = JSON.stringify(s);
        if (key === this.last) return;
        this.last = key;
        const t = strings.table;
        this.btn.querySelector('.tv-view-name')!.textContent = s.name;
        this.btn.querySelector<HTMLElement>('.tv-view-dot')!.hidden = !s.changed;
        this.btn.setAttribute('aria-label', s.changed ? `${t.viewAria(s.name)}, ${t.changed}` : t.viewAria(s.name));
        this.btn.title = s.name;
        this.changed.hidden = !s.changed;
        // Only a built-in view's mark says something more (why no Save).
        this.changed.disabled = !s.builtin;
        this.changed.classList.toggle('is-note', s.builtin);
        if (s.builtin) this.changed.title = t.builtinNote;
        else this.changed.removeAttribute('title');
        this.save.hidden = !s.changed || s.builtin || s.readOnly;
        this.saveAs.hidden = !s.changed || s.readOnly;
        this.discard.hidden = !s.changed;
        this.slot.classList.toggle('is-changed', s.changed);
    }
}

/** The view name form (§9.3 "Save as new", "Rename"): the name and what is saved. */
export function viewNameForm(name: string): { el: HTMLElement; read(): string; invalid(): void } {
    const t = strings.table;
    const el = document.createElement('div');
    el.className = 'tv-ff tv-vname';
    const id = `tv-vname-${Math.random().toString(36).slice(2, 8)}`;
    el.innerHTML = `<label class="tv-vname-label" for="${id}">${esc(t.viewNameLabel)}</label>`
        + `<input type="text" id="${id}" class="tv-vname-input" maxlength="80" autocomplete="off" spellcheck="false">`
        + `<p class="tv-vname-what">${esc(t.viewWhat)}</p>`;
    const input = el.querySelector<HTMLInputElement>('input')!;
    input.value = name;
    input.addEventListener('input', () => input.removeAttribute('aria-invalid'));
    return {
        el,
        read: () => input.value.trim(),
        invalid: () => { input.setAttribute('aria-invalid', 'true'); input.focus(); },
    };
}

/** The export's formats (§11.1: CSV in P1, XLSX in P2, §11.3). */
export type ExportFormat = 'csv' | 'xlsx';

export interface ExportSummary {
    /** People or unions written. */
    items: number;
    /** Columns written. */
    columns: number;
    /** The file's name per format. */
    files: Record<ExportFormat, string>;
    /**
     * A filter or a search narrows the rows (1110): the choice of the rows
     * shown or all of them. Absent without a filter: one fixed row as before.
     */
    filtered?: {
        /** All rows of the type. */
        total: number;
        /** The filter in words ("Deceased · “ign”"). */
        filter: string;
        /** Columns written without the filter (the "Union" column may come or go). */
        columnsAll: number;
    };
}

/** The Download button's label of a format. */
export function exportDownloadLabel(format: ExportFormat): string {
    return format === 'xlsx' ? strings.table.exportDownloadXlsx : strings.table.exportDownload;
}

/**
 * A radio group of buttons (click, tap, arrows): the checked one is the tab
 * stop and shows ●, the others ○.
 */
function radioGroup<T extends string>(picks: HTMLButtonElement[], attr: string, choose: (v: T) => void): (v: T, focus: boolean) => void {
    const mark = (v: T, focus: boolean): void => {
        for (const b of picks) {
            const on = b.getAttribute(attr) === v;
            b.setAttribute('aria-checked', String(on));
            b.tabIndex = on ? 0 : -1;
            b.querySelector('.tv-xopt-dot')!.textContent = on ? '●' : '○';
            if (on && focus) b.focus();
        }
        choose(v);
    };
    for (const b of picks) {
        b.addEventListener('click', () => mark(b.getAttribute(attr) as T, false));
        b.addEventListener('keydown', (e) => {
            if (!['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight'].includes(e.key)) return;
            e.preventDefault();
            const i = picks.indexOf(b);
            const next = picks[(i + (e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : picks.length - 1)) % picks.length];
            mark(next.getAttribute(attr) as T, true);
        });
    }
    return mark;
}

/**
 * The Export form (11a, 14d): the format (CSV · XLSX, a radio group: click,
 * tap, arrows), the rows, the file name and what goes in. A change of the
 * format updates the file name here and calls `onFormat` (the panel's button).
 * With a filter or a search (1110) the rows are a choice too: those shown
 * (the default, the count and the filter said) or all without the filter;
 * a change calls `onRows` and updates what goes in.
 */
export function exportForm(
    type: RowType, sum: ExportSummary, format: ExportFormat, onFormat: (f: ExportFormat) => void,
    onRows: (all: boolean) => void = () => {},
): HTMLElement {
    const t = strings.table;
    const k = ROW_KEY[type];
    const el = document.createElement('div');
    el.className = 'tv-xform';
    const pick = (attr: string, value: string, on: boolean, html: string): string =>
        `<button type="button" class="tv-xopt tv-xopt-pick" role="radio" ${attr}="${value}" aria-checked="${on}" tabindex="${on ? 0 : -1}">`
        + `<span class="tv-xopt-dot" aria-hidden="true">${on ? '●' : '○'}</span><span class="tv-xopt-text">${html}</span></button>`;
    const opt = (label: string): string => '<div class="tv-xopt" role="radio" aria-checked="true">'
        + `<span class="tv-xopt-dot" aria-hidden="true">●</span><span>${esc(label)}</span></div>`;
    const f = sum.filtered;
    const rows = f
        ? pick('data-rows', 'shown', true, `${esc(t.exportShown(t.countOf[k](sum.items, f.total)))}`
            + ` <span class="tv-xopt-note">${esc(t.exportFilterNote(f.filter))}</span>`)
          + pick('data-rows', 'all', false, esc(t.exportUnfiltered[k](f.total)))
        : opt(t.exportAll[k](sum.items));
    el.innerHTML = `<div class="tv-xlab" id="tv-xf-format">${esc(t.exportFormat)}</div>`
        + `<div class="tv-xformats" role="radiogroup" aria-labelledby="tv-xf-format">${pick('data-format', 'csv', format === 'csv', esc(t.exportCsv))}${pick('data-format', 'xlsx', format === 'xlsx', esc(t.exportXlsx))}</div>`
        + '<div class="tv-xsep" role="separator"></div>'
        + `<div class="tv-xlab" id="tv-xf-rows">${esc(t.exportRows)}</div>`
        + `<div class="tv-xrows" role="radiogroup" aria-labelledby="tv-xf-rows">${rows}</div>`
        + '<div class="tv-xsep" role="separator"></div>'
        + `<p class="tv-xfile">${esc(t.exportFile(sum.files[format]))}</p>`
        + `<p class="tv-xwhat">${esc(t.exportWhat[k](sum.columns))}</p>`;
    radioGroup<ExportFormat>([...el.querySelectorAll<HTMLButtonElement>('[data-format]')], 'data-format', (v) => {
        el.querySelector('.tv-xfile')!.textContent = t.exportFile(sum.files[v]);
        if (v !== format) {
            format = v;
            onFormat(v);
        }
    });
    if (f) {
        let all = false;
        radioGroup<'shown' | 'all'>([...el.querySelectorAll<HTMLButtonElement>('[data-rows]')], 'data-rows', (v) => {
            el.querySelector('.tv-xwhat')!.textContent = v === 'all' ? t.exportWhatAll[k](f.columnsAll) : t.exportWhat[k](sum.columns);
            if ((v === 'all') !== all) {
                all = v === 'all';
                onRows(all);
            }
        });
    }
    return el;
}
