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
}

/** The Download button's label of a format. */
export function exportDownloadLabel(format: ExportFormat): string {
    return format === 'xlsx' ? strings.table.exportDownloadXlsx : strings.table.exportDownload;
}

/**
 * The Export form (11a, 14d): the format (CSV · XLSX, a radio group: click,
 * tap, arrows), the rows, the file name and what goes in. A change of the
 * format updates the file name here and calls `onFormat` (the panel's button).
 */
export function exportForm(type: RowType, sum: ExportSummary, format: ExportFormat, onFormat: (f: ExportFormat) => void): HTMLElement {
    const t = strings.table;
    const k = ROW_KEY[type];
    const el = document.createElement('div');
    el.className = 'tv-xform';
    const pick = (f: ExportFormat, label: string): string => {
        const on = f === format;
        return `<button type="button" class="tv-xopt tv-xopt-pick" role="radio" data-format="${f}" aria-checked="${on}" tabindex="${on ? 0 : -1}">`
            + `<span class="tv-xopt-dot" aria-hidden="true">${on ? '●' : '○'}</span><span>${esc(label)}</span></button>`;
    };
    const opt = (label: string): string => '<div class="tv-xopt" role="radio" aria-checked="true">'
        + `<span class="tv-xopt-dot" aria-hidden="true">●</span><span>${esc(label)}</span></div>`;
    el.innerHTML = `<div class="tv-xlab" id="tv-xf-format">${esc(t.exportFormat)}</div>`
        + `<div class="tv-xformats" role="radiogroup" aria-labelledby="tv-xf-format">${pick('csv', t.exportCsv)}${pick('xlsx', t.exportXlsx)}</div>`
        + '<div class="tv-xsep" role="separator"></div>'
        + `<div class="tv-xlab" id="tv-xf-rows">${esc(t.exportRows)}</div>`
        + `<div role="radiogroup" aria-labelledby="tv-xf-rows">${opt(t.exportAll[k](sum.items))}</div>`
        + '<div class="tv-xsep" role="separator"></div>'
        + `<p class="tv-xfile">${esc(t.exportFile(sum.files[format]))}</p>`
        + `<p class="tv-xwhat">${esc(t.exportWhat[k](sum.columns))}</p>`;
    const picks = [...el.querySelectorAll<HTMLButtonElement>('.tv-xopt-pick')];
    const choose = (f: ExportFormat, focus: boolean): void => {
        for (const b of picks) {
            const on = b.dataset.format === f;
            b.setAttribute('aria-checked', String(on));
            b.tabIndex = on ? 0 : -1;
            b.querySelector('.tv-xopt-dot')!.textContent = on ? '●' : '○';
            if (on && focus) b.focus();
        }
        el.querySelector('.tv-xfile')!.textContent = t.exportFile(sum.files[f]);
        if (f !== format) {
            format = f;
            onFormat(f);
        }
    };
    for (const b of picks) {
        b.addEventListener('click', () => choose(b.dataset.format as ExportFormat, false));
        b.addEventListener('keydown', (e) => {
            if (!['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight'].includes(e.key)) return;
            e.preventDefault();
            const i = picks.indexOf(b);
            const next = picks[(i + (e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : picks.length - 1)) % picks.length];
            choose(next.dataset.format as ExportFormat, true);
        });
    }
    return el;
}
