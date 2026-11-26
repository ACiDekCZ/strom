/**
 * The person popover of the tree overview, shared with the family book's
 * dialog (1031 §4.2): a search field over a list — empty, it offers the person
 * in focus and the recently chosen; typed, the best matches (filterAndSort).
 * Arrow keys move through the rows, Enter takes the first, Escape and a click
 * outside close it. Styles: `.tov-pop*` in index.html.
 */

import { Person, PersonId, StromData } from '../types.js';
import { shownName } from '../person-name.js';
import { filterAndSort } from '../person-picker.js';
import { displayYear } from '../dates.js';
import { MQ_MOBILE } from '../breakpoints.js';

const PICK_LIMIT = 50;

export interface PersonPopoverOptions {
    /** Where the popover is put (an overlay: it is positioned fixed under the anchor). */
    host: HTMLElement;
    /** The button it opens from: aria-expanded, the position, focus on Escape. */
    anchor: HTMLElement;
    data: StromData;
    /** The person chosen now (marked selected). */
    selectedId: PersonId | null;
    /** The rows of the empty search, in order: each with its note ("in focus", "recent"). */
    suggested: ReadonlyArray<{ id: PersonId; meta: string }>;
    labels: { search: string; list: string; noMatch: string };
    onPick: (id: PersonId) => void;
    /** After it closed (picked, Escape, a click outside). */
    onClose?: () => void;
}

function esc(text: string): string {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** One row of a search popover: its id, name, the muted line under it and a count at its end. */
export interface SearchPopoverRow {
    id: string;
    name: string;
    meta?: string;
    count?: string;
}

/** A group of rows, with its heading (none: the rows alone). */
export interface SearchPopoverGroup {
    head?: string;
    rows: readonly SearchPopoverRow[];
}

export interface SearchPopoverOptions {
    host: HTMLElement;
    anchor: HTMLElement;
    selectedId: string | null;
    labels: { search: string; list: string; noMatch: string };
    /** The rows for the typed text ('' = the empty search). */
    groups: (query: string) => readonly SearchPopoverGroup[];
    onPick: (id: string) => void;
    onClose?: () => void;
}

/**
 * A search field over a list of rows in groups, under its button: the person
 * popover's look and keys (arrows, Enter takes the first, Escape and a click
 * outside close it). The family book's house (spec 030 §8) uses it too.
 */
export function openSearchPopover(o: SearchPopoverOptions): () => void {
    const { host, anchor } = o;
    const pop = document.createElement('div');
    pop.className = 'tov-pop';
    pop.innerHTML = `
        <input type="search" class="tov-pop-search" placeholder="${esc(o.labels.search)}" aria-label="${esc(o.labels.search)}"
            autocomplete="off" spellcheck="false">
        <div class="tov-pop-list" role="listbox" aria-label="${esc(o.labels.list)}"></div>`;
    host.appendChild(pop);
    const place = (): void => {
        const r = anchor.getBoundingClientRect();
        if (window.matchMedia(MQ_MOBILE).matches) {
            pop.style.left = '16px';
            pop.style.right = '16px';
            pop.style.width = 'auto';
        } else {
            pop.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - 328))}px`;
        }
        pop.style.top = `${r.bottom + 6}px`;
        pop.style.maxHeight = `${Math.max(160, window.innerHeight - r.bottom - 22)}px`;
    };
    place();
    const input = pop.querySelector<HTMLInputElement>('.tov-pop-search')!;
    const list = pop.querySelector<HTMLElement>('.tov-pop-list')!;
    const row = (r: SearchPopoverRow): string => {
        const text = `<span class="tov-pop-name">${esc(r.name)}</span>${r.meta ? `<span class="tov-pop-meta">${esc(r.meta)}</span>` : ''}`;
        return `<button type="button" class="tov-pop-row sel-opt${r.count ? ' tov-pop-row--count' : ''}" data-sel-form="row" role="option" data-id="${esc(r.id)}" aria-selected="${r.id === o.selectedId}">`
            + (r.count ? `<span class="tov-pop-main">${text}</span><span class="tov-pop-count">${esc(r.count)}</span>` : text)
            + `</button>`;
    };
    const render = (): void => {
        const groups = o.groups(input.value.trim()).filter(g => g.rows.length);
        list.innerHTML = groups.length
            ? groups.map(g => (g.head ? `<div class="tov-pop-head" role="presentation">${esc(g.head)}</div>` : '') + g.rows.map(row).join('')).join('')
            : `<div class="tov-pop-none">${esc(o.labels.noMatch)}</div>`;
    };
    render();
    anchor.setAttribute('aria-expanded', 'true');
    const onDown = (e: MouseEvent): void => {
        if (!pop.contains(e.target as Node) && !anchor.contains(e.target as Node)) close();
    };
    let closed = false;
    const close = (): void => {
        if (closed) return;
        closed = true;
        pop.remove();
        document.removeEventListener('mousedown', onDown, true);
        anchor.setAttribute('aria-expanded', 'false');
        o.onClose?.();
    };
    document.addEventListener('mousedown', onDown, true);
    input.addEventListener('input', render);
    pop.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            close();
            anchor.focus();
            return;
        }
        const rows = [...list.querySelectorAll<HTMLElement>('.tov-pop-row')];
        const at = rows.indexOf(document.activeElement as HTMLElement);
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            rows[Math.min(rows.length - 1, at + 1)]?.focus();
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            if (at <= 0) input.focus(); else rows[at - 1]?.focus();
        } else if (e.key === 'Enter' && document.activeElement === input && rows[0]) {
            e.preventDefault();
            rows[0].click();
        }
    });
    list.addEventListener('click', (e) => {
        const r = (e.target as HTMLElement).closest<HTMLElement>('.tov-pop-row');
        if (!r) return;
        e.stopPropagation();
        close();
        o.onPick(r.dataset.id ?? '');
    });
    input.focus();
    return close;
}

/** Open the person popover; returns its close function. */
export function openPersonPopover(o: PersonPopoverOptions): () => void {
    const { data } = o;
    const persons = Object.values(data.persons).filter(p => !p.isPlaceholder);
    const real = (id: PersonId): Person | null => {
        const p = data.persons[id];
        return p && !p.isPlaceholder ? p : null;
    };
    const row = (p: Person, meta: string): SearchPopoverRow => {
        const born = p.birthDate ? `* ${displayYear(p.birthDate)}` : '';
        return { id: p.id, name: shownName(p), meta: [born, meta].filter(Boolean).join(' · ') };
    };
    return openSearchPopover({
        host: o.host, anchor: o.anchor, selectedId: o.selectedId, labels: o.labels,
        groups: (q) => {
            if (!q) {
                const rows: SearchPopoverRow[] = [];
                const seen = new Set<PersonId>();
                for (const s of o.suggested) {
                    const p = real(s.id);
                    if (p && !seen.has(p.id)) { rows.push(row(p, s.meta)); seen.add(p.id); }
                }
                return [{ rows: rows.length ? rows : filterAndSort('', persons, data).slice(0, PICK_LIMIT).map(p => row(p, '')) }];
            }
            return [{ rows: filterAndSort(q, persons, data).slice(0, PICK_LIMIT).map(p => row(p, '')) }];
        },
        onPick: (id) => o.onPick(id as PersonId),
        ...(o.onClose ? { onClose: o.onClose } : {}),
    });
}
