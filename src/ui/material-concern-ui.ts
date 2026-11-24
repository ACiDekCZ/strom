/**
 * "Concerns" in the material dialog (spec 137 §6.3): the first field of the
 * form says whom the files concern — the dialog's person (or "Source only"
 * for a source) or one of the tree's lists of people. The field opens a menu:
 * a popover under it, a bottom sheet on a phone. Keyboard: Enter / Space / ↓
 * open it, ↑ / ↓ move, Enter chooses, Esc closes and returns to the field.
 *
 * The choice lives only in the open dialog (material-ui.ts keeps it on the
 * overlay); every opening starts with the person or the source.
 */

import { DataManager } from '../data.js';
import { strings } from '../strings.js';
import { iconSvg } from '../icons.js';
import { listDisplayName, listKind, foldListName, type ListKind } from '../person-lists.js';
import { materialListFacts } from '../material-list.js';
import { listKindIcon } from './list-kind-icon.js';
import { listSub } from './selection-picker-ui.js';
import { isPhoneBar } from '../breakpoints.js';

const MENU_ID = 'material-concern-menu';
const BACKDROP_ID = 'material-concern-backdrop';
/** From this many lists the menu has a field to find one (spec 137 §6.3: over 8). */
const FIND_FROM = 9;

/** What the field shows. */
export type ConcernShown =
    | { kind: 'person'; name: string; years: string }
    | { kind: 'source' }
    | { kind: 'list'; name: string; listKind: ListKind; count: number };

/** A list in the menu, counted when the menu opens (automatic lists are worked out anew). */
export interface ConcernListRow {
    id: string;
    name: string;
    kind: ListKind;
    sub: string;
    count: number;
    /** People of the list the research knows (has a number for). */
    known: number;
}

function esc(text: string): string {
    return text
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const CHEVRON = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M6 9l6 6 6-6"/></svg>';

/** The field's inside: the icon, the name and what it holds. */
function shownHtml(c: ConcernShown): string {
    const m = strings.material;
    switch (c.kind) {
        case 'person':
            return `<span class="material-concern-icon">${iconSvg('user', { size: 16 })}</span>`
                + `<span class="material-concern-name is-person">${esc(c.name)}</span>`
                + (c.years ? `<span class="material-concern-years">${esc(c.years)}</span>` : '');
        case 'source':
            return `<span class="material-concern-icon">${iconSvg('book', { size: 16 })}</span>`
                + `<span class="material-concern-name">${esc(m.sourceOnly)}</span>`;
        case 'list':
            return `<span class="material-concern-icon">${listKindIcon(c.listKind, 16)}</span>`
                + `<span class="material-concern-name is-list">${esc(c.name)}</span>`
                + `<span class="material-concern-count">${esc(strings.lists.persons(c.count))}</span>`;
    }
}

/** The field "Concerns" with its label (the first field of the form). */
export function concernFieldHtml(c: ConcernShown): string {
    const m = strings.material;
    return `<div class="material-concern-wrap">
                        <label class="material-concern-label" for="material-concern">${esc(m.concern)}</label>
                        <button type="button" class="material-concern" id="material-concern" aria-haspopup="listbox" aria-expanded="false" data-concern-kind="${c.kind}">${shownHtml(c)}<span class="material-concern-chev">${CHEVRON}</span></button>
                    </div>`;
}

/** The tree's lists for the menu, in the order of the Lists of people dialog. */
export function concernListRows(): ConcernListRow[] {
    const data = DataManager.getData();
    return DataManager.getPersonLists().map(l => {
        const ids = DataManager.getPersonListIds(l.id);
        return { id: l.id, name: listDisplayName(l), kind: listKind(l), sub: listSub(l), count: ids.length, known: materialListFacts(data, ids).known };
    });
}

interface MenuOpts {
    overlay: HTMLElement;
    field: HTMLButtonElement;
    /** The first group: the dialog's person, or the source ("Source only"). */
    first: { kind: 'person'; name: string; years: string } | { kind: 'source' };
    lists: ConcernListRow[];
    /** The chosen list's id ('' = the person / the source). */
    current: string;
    onChoose: (id: string) => void;
}

let open: { opts: MenuOpts; onKey: (e: KeyboardEvent) => void; onResize: () => void } | null = null;

export function concernMenuOpen(): boolean {
    return open !== null;
}

/** Close the menu (`focus`: back to the field). False when it was not open. */
export function closeConcernMenu(focus = false): boolean {
    if (!open) return false;
    const { opts, onKey, onResize } = open;
    open = null;
    document.getElementById(MENU_ID)?.remove();
    document.getElementById(BACKDROP_ID)?.remove();
    document.removeEventListener('keydown', onKey, true);
    window.removeEventListener('resize', onResize);
    opts.field.setAttribute('aria-expanded', 'false');
    if (focus && opts.field.isConnected) opts.field.focus();
    return true;
}

function optionHtml(o: { id: string; icon: string; name: string; nameClass?: string; extra?: string; sub?: string; count: string; selected: boolean; disabled?: boolean }): string {
    return `<div class="sel-opt material-concern-opt" data-sel-form="row" role="option" tabindex="-1" data-concern="${esc(o.id)}" aria-selected="${o.selected}"${o.disabled ? ' aria-disabled="true"' : ''}>`
        + `<span class="material-concern-opt-icon">${o.icon}</span>`
        + `<span class="material-concern-opt-mid"><span class="material-concern-opt-name${o.nameClass ? ` ${o.nameClass}` : ''}">${esc(o.name)}${o.extra ? ` <span class="material-concern-opt-years">${esc(o.extra)}</span>` : ''}</span>`
        + (o.sub ? `<span class="material-concern-opt-sub">${esc(o.sub)}</span>` : '')
        + `</span><span class="material-concern-opt-count">${esc(o.count)}</span></div>`;
}

function menuHtml(opts: MenuOpts, sheet: boolean): string {
    const m = strings.material;
    const first = opts.first.kind === 'person'
        ? optionHtml({ id: '', icon: iconSvg('user', { size: 16 }), name: opts.first.name, nameClass: 'is-person', extra: opts.first.years, count: '', selected: opts.current === '' })
        : optionHtml({ id: '', icon: iconSvg('book', { size: 16 }), name: m.sourceOnly, count: '', selected: opts.current === '' });
    const lists = opts.lists.map(l => optionHtml({
        id: l.id, icon: listKindIcon(l.kind, 15), name: l.name,
        // A list the research knows nobody of: offered, said so (the material then goes to the person alone).
        sub: l.count > 0 && l.known === 0 ? `${strings.lists.kind[l.kind]} · ${m.listUnknown}` : l.sub,
        count: l.count > 0 ? strings.lists.persons(l.count) : m.listEmpty,
        selected: opts.current === l.id, disabled: l.count === 0,
    })).join('');
    const find = opts.lists.length >= FIND_FROM
        ? `<div class="material-concern-find-wrap"><input type="search" class="material-concern-find" placeholder="${esc(m.listFind)}" aria-label="${esc(m.listFind)}" autocomplete="off"></div>` : '';
    const head = sheet ? `<div class="material-concern-grip" aria-hidden="true"></div>
            <div class="material-concern-head"><span class="material-concern-title" id="material-concern-title">${esc(m.concern)}</span>`
        + `<button type="button" class="material-concern-x" aria-label="${esc(strings.buttons.close)}">&times;</button></div>` : '';
    const firstHead = opts.first.kind === 'person' ? m.concernPerson : m.concernSource;
    return `${head}${find}<div class="material-concern-options" role="listbox" ${sheet ? 'aria-labelledby="material-concern-title"' : `aria-label="${esc(m.concern)}"`}>
            <div role="group" aria-labelledby="material-concern-g1"><div class="material-concern-group" id="material-concern-g1">${esc(firstHead)}</div>${first}</div>
            ${opts.lists.length ? `<div role="group" aria-labelledby="material-concern-g2"><div class="material-concern-group" id="material-concern-g2">${esc(m.concernLists)}</div>${lists}</div>` : ''}
        </div>`;
}

/** Place the popover under the field (above it when there is no room below), the field's width. */
function placePopover(menu: HTMLElement, field: HTMLElement): void {
    const r = field.getBoundingClientRect();
    const vh = window.innerHeight;
    const below = vh - r.bottom - 12;
    const above = r.top - 12;
    const up = below < 200 && above > below;
    menu.style.left = `${Math.round(r.left)}px`;
    menu.style.width = `${Math.round(r.width)}px`;
    menu.style.maxHeight = `${Math.max(120, Math.min(360, up ? above : below))}px`;
    if (up) { menu.style.top = ''; menu.style.bottom = `${Math.round(vh - r.top + 4)}px`; }
    else { menu.style.bottom = ''; menu.style.top = `${Math.round(r.bottom + 4)}px`; }
}

function enabledOptions(menu: HTMLElement): HTMLElement[] {
    return Array.from(menu.querySelectorAll<HTMLElement>('.material-concern-opt'))
        .filter(o => o.getAttribute('aria-disabled') !== 'true' && !o.hidden);
}

/** Open the menu of the field. */
export function openConcernMenu(opts: MenuOpts): void {
    closeConcernMenu();
    const sheet = isPhoneBar();
    const menu = document.createElement('div');
    menu.id = MENU_ID;
    menu.className = `material-concern-menu${sheet ? ' is-sheet' : ''}`;
    if (sheet) {
        menu.setAttribute('role', 'dialog');
        menu.setAttribute('aria-modal', 'true');
        menu.setAttribute('aria-labelledby', 'material-concern-title');
        const backdrop = document.createElement('div');
        backdrop.id = BACKDROP_ID;
        backdrop.className = 'material-concern-backdrop';
        backdrop.addEventListener('click', () => closeConcernMenu(true));
        opts.overlay.appendChild(backdrop);
    }
    menu.innerHTML = menuHtml(opts, sheet);
    opts.overlay.appendChild(menu);
    if (!sheet) placePopover(menu, opts.field);
    opts.field.setAttribute('aria-expanded', 'true');

    const choose = (o: HTMLElement): void => {
        if (o.getAttribute('aria-disabled') === 'true') return;
        const id = o.dataset.concern ?? '';
        closeConcernMenu();
        opts.onChoose(id);
    };
    menu.addEventListener('click', (e) => {
        const t = e.target as HTMLElement;
        if (t.closest('.material-concern-x')) { closeConcernMenu(true); return; }
        const o = t.closest<HTMLElement>('.material-concern-opt');
        if (o) choose(o);
    });
    // A press on an option keeps the focus where it is until the choice (no flash of the focus ring).
    menu.addEventListener('pointerdown', (e) => {
        if ((e.target as HTMLElement).closest('.material-concern-opt')) e.preventDefault();
    });
    const find = menu.querySelector<HTMLInputElement>('.material-concern-find');
    find?.addEventListener('input', () => {
        const q = foldListName(find.value);
        menu.querySelectorAll<HTMLElement>('.material-concern-opt[data-concern]:not([data-concern=""])').forEach(o => {
            const row = opts.lists.find(l => l.id === o.dataset.concern);
            o.hidden = !!q && !!row && !foldListName(row.name).includes(q);
        });
    });

    const onKey = (e: KeyboardEvent): void => {
        const active = document.activeElement as HTMLElement | null;
        if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            closeConcernMenu(true);
            return;
        }
        if (e.key === 'Tab') {
            if (sheet) { e.preventDefault(); return; }
            closeConcernMenu();
            return;
        }
        const opt = active?.closest<HTMLElement>('.material-concern-opt');
        const inFind = active === find;
        if (!opt && !inFind) return;
        const list = enabledOptions(menu);
        const at = opt ? list.indexOf(opt) : -1;
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Home' || e.key === 'End') {
            e.preventDefault();
            e.stopPropagation();
            if (!list.length) return;
            let next: number;
            if (e.key === 'Home') next = 0;
            else if (e.key === 'End') next = list.length - 1;
            else if (e.key === 'ArrowDown') next = at < 0 ? 0 : Math.min(list.length - 1, at + 1);
            else {
                if (at <= 0 && find) { find.focus(); return; }
                next = Math.max(0, at - 1);
            }
            list[next].focus();
            list[next].scrollIntoView({ block: 'nearest' });
            return;
        }
        if ((e.key === 'Enter' || e.key === ' ') && opt) {
            e.preventDefault();
            e.stopPropagation();
            choose(opt);
        }
    };
    document.addEventListener('keydown', onKey, true);
    const onResize = (): void => {
        // The sheet / popover follows the window: a phone turned sideways gets the sheet, and back.
        if (!open) return;
        if (isPhoneBar() !== sheet) { closeConcernMenu(true); return; }
        if (!sheet) placePopover(menu, opts.field);
    };
    window.addEventListener('resize', onResize);
    open = { opts, onKey, onResize };

    const selected = menu.querySelector<HTMLElement>('.material-concern-opt[aria-selected="true"]');
    const start = selected && selected.getAttribute('aria-disabled') !== 'true' ? selected : enabledOptions(menu)[0];
    start?.focus();
    start?.scrollIntoView({ block: 'nearest' });
}
