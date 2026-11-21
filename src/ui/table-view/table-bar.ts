/**
 * Table view (spec 073 §1.4, §1.5, §2): the table's bar and status line.
 *
 * Row 1: the row type (a segmented radio group; on a phone a button that
 * opens a sheet), then slots the later parts fill (the view picker §9, search
 * §8, Columns §4, Export §11), "Open in a new window" (⧉, spec 079 §1; not on a
 * phone nor in a window opened so) and the phone's ⋯ (§12, which takes Columns and
 * Export). Row 2 holds the filter chips (§8; hidden while empty) — the slot
 * whose content the selection bar of a later phase replaces (§15). The status line under the grid: "N of M people", the sort, and the
 * Marks button (§7, hidden until it has its bubble).
 */

import { strings } from '../../strings.js';
import { busySpinHtml } from '../busy.js';
import { columnById, columnLabel, columnOffered, type SortSpec } from './table-columns.js';
import { ROW_KEY, ROW_TYPES, type RowType } from './table-model.js';
import { listKindIcon } from '../list-kind-icon.js';
import type { ListKind } from '../../person-lists.js';
import { isPhoneBar } from '../../breakpoints.js';
import { selectionIcon } from '../../rod-picker.js';
import type { SelectionKind } from '../../view-selection-ref.js';

export interface BarHandlers {
    /** A row type was chosen (segment or sheet). */
    onRowType(type: RowType): void;
    /** The phone's row-type button: open the sheet. */
    onRowTypeSheet(): void;
    /** The phone's ⋯ (12a): Columns, Export, Coverage row, Expand or Collapse unions. */
    onMoreMenu(): void;
    /** ‹ / › (spec 103 §1): a jump by a name back or forward. */
    onHistory(dir: -1 | 1): void;
    /** The scope folded into one button where the bar is tight (spec 098 §11c, 11c·2): its menu. */
    onScopeMenu(anchor: HTMLElement): void;
}

function esc(text: string): string {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}


/** "12 of 38 people" for a row type. */
export function countText(type: RowType, shown: number, total: number): string {
    return strings.table.countOf[ROW_KEY[type]](shown, total);
}

/** "Sort: Birth date ↑, Name ↓" (empty without a sort). */
export function sortText(type: RowType, sort: readonly SortSpec[]): string {
    // A list's own order (spec 084 §9): "Sort: # (list order)".
    if (type === 'persons' && sort.length === 1 && sort[0].col === 'num' && sort[0].dir !== 'desc') return strings.table.sortList;
    const cols = sort
        .map(s => { const col = columnById(type, s.col); return col && columnOffered(col) ? `${columnLabel(col)} ${s.dir === 'desc' ? '↓' : '↑'}` : ''; })
        .filter(Boolean);
    return cols.length ? strings.table.sortedBy(cols.join(', ')) : '';
}

/**
 * ‹ / › (spec 103 §1): shown from the first jump on, each off without a
 * step that way; their names say where they lead.
 */
export function updateNav(bar: HTMLElement, any: boolean, back: string | null, forward: string | null): void {
    const slot = bar.querySelector<HTMLElement>('.tv-slot-nav');
    if (!slot) return;
    slot.hidden = !any;
    const set = (dir: string, label: string | null, named: (n: string) => string, plain: string): void => {
        const btn = slot.querySelector<HTMLElement>(`[data-nav="${dir}"]`)!;
        const text = label ? named(label) : plain;
        btn.setAttribute('aria-disabled', label === null ? 'true' : 'false');
        btn.setAttribute('aria-label', text);
        btn.title = text;
    };
    const nav = strings.table.nav;
    set('-1', back, nav.backTo, nav.back);
    set('1', forward, nav.forwardTo, nav.forward);
}

/**
 * The bar's skeleton; `updateBar` fills the row type. `scopeSeg`: the shared
 * scope switch's markup (This view / Selection ▾ / Whole tree and the
 * phone's "Scope: … ▾", src/ui/scope-seg-ui.ts), after the label "Scope"
 * and before the button it folds into where the bar is tight.
 */
export function createBar(handlers: BarHandlers, scopeSeg = ''): HTMLElement {
    const bar = document.createElement('div');
    bar.className = 'tv-bar';
    bar.innerHTML = '<div class="tv-bar-row1">'
        + '<div class="tv-slot tv-slot-nav" hidden>'
        + `<button type="button" class="tv-nav-btn" data-nav="-1" aria-disabled="true" aria-label="${esc(strings.table.nav.back)}" title="${esc(strings.table.nav.back)}">‹</button>`
        + `<button type="button" class="tv-nav-btn" data-nav="1" aria-disabled="true" aria-label="${esc(strings.table.nav.forward)}" title="${esc(strings.table.nav.forward)}">›</button>`
        + '<span class="tv-bar-sep" aria-hidden="true"></span>'
        + '</div>'
        + `<div class="tv-rowtype sel-seg" role="radiogroup" aria-label="${esc(strings.table.rowType)}"></div>`
        + '<button type="button" class="tv-rowtype-btn" aria-haspopup="dialog"></button>'
        + `<div class="tv-slot tv-slot-scope"><span class="tv-scope-label" aria-hidden="true">${esc(strings.scope.label)}</span>`
        + scopeSeg
        + '<button type="button" class="tv-scope-btn" aria-haspopup="menu"></button></div>'
        + '<div class="tv-slot tv-slot-view"></div>'
        + '<div class="tv-bar-spacer"></div>'
        + '<div class="tv-slot tv-slot-search"></div>'
        + '<div class="tv-slot tv-slot-cols"></div>'
        + '<div class="tv-slot tv-slot-export"></div>'
        + '<div class="tv-slot tv-slot-window"></div>'
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
    const scopeBtn = bar.querySelector<HTMLElement>('.tv-scope-btn')!;
    scopeBtn.addEventListener('click', () => { if (scopeBtn.getAttribute('aria-disabled') !== 'true') handlers.onScopeMenu(scopeBtn); });
    bar.querySelector('.tv-slot-nav')!.addEventListener('click', (e) => {
        const btn = (e.target as Element).closest<HTMLElement>('[data-nav]');
        if (btn && btn.getAttribute('aria-disabled') !== 'true') handlers.onHistory(Number(btn.dataset.nav) as -1 | 1);
    });
    return bar;
}

/** The row-type segment and the phone button for the current type and counts. */
export function updateBar(bar: HTMLElement, type: RowType, counts: Record<RowType, number>): void {
    const seg = bar.querySelector<HTMLElement>('.tv-rowtype')!;
    seg.innerHTML = ROW_TYPES.map(t => {
        const on = t === type;
        const label = strings.table.rows[t];
        return `<button type="button" class="segment-btn sel-opt${on ? ' active' : ''}" data-sel-form="seg" role="radio" data-rowtype="${t}"`
            + ` aria-checked="${on}" tabindex="${on ? 0 : -1}" aria-label="${esc(strings.table.rowTypeAria(label, counts[t]))}">`
            + `${esc(label)}<span class="tv-rowtype-count" aria-hidden="true">${counts[t]}</span></button>`;
    }).join('');
    const btn = bar.querySelector<HTMLElement>('.tv-rowtype-btn')!;
    const label = strings.table.rows[type];
    btn.textContent = `${label} · ${counts[type]} ▾`;
    btn.setAttribute('aria-label', `${strings.table.rowType}: ${strings.table.rowTypeAria(label, counts[type])}`);
}

/**
 * The scope as the folded button shows it (spec 098 §11c, 11c·2): This view,
 * the window's selection (a list with its kind, another selection with its
 * icon; its name "List: …") or the Whole tree.
 */
export interface ScopeShown {
    scope: 'view' | 'sel' | 'tree';
    /** The selection's name ("List: Letters to write") when the scope is Selection. */
    name?: string;
    /** A list's kind (its icon). */
    list?: ListKind;
    /** Another selection's kind (its icon). */
    sel?: Exclude<SelectionKind, 'list'>;
    /** Sources: the scope does not apply (dimmed, says why). */
    disabled: boolean;
}

/** The whole tree's glyph in a tight bar: lines of a list. */
const SCOPE_GLYPH = '<svg class="tv-scope-glyph" width="14" height="14" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor"'
    + ' stroke-width="1.6" stroke-linecap="round"><path d="M6 4h8M6 8h8M6 12h8"/><circle cx="2.5" cy="4" r=".6"/><circle cx="2.5" cy="8" r=".6"/><circle cx="2.5" cy="12" r=".6"/></svg>';

/** This view's glyph in a tight bar: a couple over a child (the Family view's people). */
const VIEW_GLYPH = '<svg class="tv-scope-glyph" width="14" height="14" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor"'
    + ' stroke-width="1.5" stroke-linecap="round"><rect x="1.5" y="2" width="5" height="4" rx="1"/><rect x="9.5" y="2" width="5" height="4" rx="1"/>'
    + '<rect x="5.5" y="10" width="5" height="4" rx="1"/><path d="M6.5 4h3M8 4v6"/></svg>';

/** The folded scope button (spec 098 §11c; shown where the bar is tight, the segment otherwise). */
export function updateScope(bar: HTMLElement, shown: ScopeShown): void {
    const btn = bar.querySelector<HTMLElement>('.tv-scope-btn')!;
    const s = strings.scope;
    const sel = shown.scope === 'sel' && !!shown.name;
    const name = sel ? shown.name! : shown.scope === 'tree' ? s.tree : s.view;
    const key = JSON.stringify([shown, strings.scope.btn('')]);
    if (btn.dataset.key === key) return;
    btn.dataset.key = key;
    btn.dataset.scope = shown.scope;
    btn.classList.toggle('is-list', sel);
    btn.classList.toggle('is-sel', sel && !!shown.sel);
    const icon = sel && shown.list ? listKindIcon(shown.list, 14)
        : sel && shown.sel ? `<span class="tv-scope-selic" aria-hidden="true">${selectionIcon(shown.sel)}</span>`
            : shown.scope === 'view' ? VIEW_GLYPH : SCOPE_GLYPH;
    btn.innerHTML = icon + `<span class="tv-scope-name">${esc(name)}</span><span class="tv-scope-caret" aria-hidden="true">▾</span>`;
    btn.setAttribute('aria-label', s.btn(name));
    if (shown.disabled) {
        btn.setAttribute('aria-disabled', 'true');
        btn.title = strings.table.scopeSources;
    } else {
        btn.removeAttribute('aria-disabled');
        btn.title = s.btn(name);
    }
}

/**
 * The steps row 1 takes on a computer and at a tablet's width before it would wrap (⧉ and ⋯ alone on
 * a second row): 0 the labels Scope and View hidden (the scope's switch
 * stays whole: de at 1440); 1 the switch folded into one button with the
 * scope's name (spec 098 §11c, 11c·2); 2 This view and the whole tree as a
 * glyph, the search, the list's name and the view's name narrower (…);
 * 3 the Columns count hidden, both names narrower still; 4 the names at
 * their narrowest, a changed view's mark as its ● alone; 5 the search at
 * 80 px (its placeholder kept whole until then). A list keeps its name (cut
 * with "…"; as its kind's icon alone it said nothing in de). One class at a time (index.html reads each step as
 * including the ones before). Measured, not by width thresholds: a changed
 * view's buttons, a list's name, the language and the font decide what fits.
 */
const FIT_STEPS = ['tv-fit-0', 'tv-fit-1', 'tv-fit-2', 'tv-fit-3', 'tv-fit-4', 'tv-fit-5'] as const;

/** Row 1 on more than one line, or past its edge. */
function rowWraps(row: HTMLElement): boolean {
    if (row.scrollWidth > row.clientWidth) return true;
    let top = Infinity;
    let bottom = -Infinity;
    for (const el of row.children) {
        if ((el as HTMLElement).offsetParent === null) continue;
        const r = el.getBoundingClientRect();
        if (r.width === 0) continue;
        const mid = r.top + r.height / 2;
        top = Math.min(top, mid);
        bottom = Math.max(bottom, mid);
    }
    return bottom - top >= 8;
}

/** Keep row 1 on one line on a computer and at a tablet's width: the fewest steps that fit (the phone keeps its own rules). */
export function fitBarRow(bar: HTMLElement): void {
    const row = bar.querySelector<HTMLElement>('.tv-bar-row1');
    if (!row) return;
    row.classList.remove(...FIT_STEPS);
    if (isPhoneBar() || row.offsetParent === null) return;
    let at: string | null = null;
    for (const step of FIT_STEPS) {
        if (!rowWraps(row)) return;
        if (at) row.classList.remove(at);
        row.classList.add(step);
        at = step;
    }
}

/**
 * ⧉ "Open in a new window" (spec 079 §1, 1c): an icon button as square as
 * Columns and Export are tall; shown only where windows are offered.
 */
export function createWindowButton(onClick: () => void): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'tv-window-btn table-bar__window';
    btn.hidden = true;
    btn.innerHTML = '<span aria-hidden="true">⧉</span>';
    btn.setAttribute('aria-label', strings.win.openInNewWindow);
    btn.title = strings.win.openInNewWindow;
    btn.addEventListener('click', onClick);
    return btn;
}

/** The status line's skeleton. */
export function createStatus(): HTMLElement {
    const el = document.createElement('div');
    el.className = 'tv-status';
    el.innerHTML = '<span class="tv-status-count" aria-live="polite"></span>'
        + '<span class="tv-status-sort"></span>'
        + '<span class="tv-status-agent" hidden><svg class="tv-status-agent-mark" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true">'
        + '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="3" fill="currentColor"/></svg>'
        + `<span class="tv-status-agent-text" aria-live="polite"></span><button type="button" class="tv-status-agent-show">${esc(strings.table.link.showTemp)}</button></span>`
        + '<span class="tv-status-right">'
        + '<span class="tv-status-res" hidden></span>'
        + `<span class="tv-status-checks" role="status" hidden>${busySpinHtml(12)}${esc(strings.table.checksRunning)}</span>`
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
export function updateStatus(
    el: HTMLElement, type: RowType, shown: number, total: number, sort: readonly SortSpec[], checking = false, readOnly = false,
    groups: { n: number; distinct: number | null } | null = null,
): void {
    el.querySelector<HTMLElement>('.tv-status-ro')!.hidden = !readOnly;
    // Grouped (spec 084 §10): "40 of 100 people · 12 groups"; "40 different people · 12 groups" when a person is in several.
    const count = groups?.distinct != null ? strings.table.distinct(groups.distinct) : countText(type, shown, total);
    el.querySelector('.tv-status-count')!.textContent = groups ? `${count} · ${strings.table.groupsN(groups.n)}` : count;
    el.querySelector('.tv-status-sort')!.textContent = sortText(type, sort);
    el.querySelector<HTMLElement>('.tv-status-checks')!.hidden = !checking;
}

/**
 * Another window following the agent (spec 097 §5, dotaz 6): "◎ The agent's
 * row is hidden by the filter · Show for now" after the sort while the
 * agent's person (`person`) is hidden; null: none. The sentence is written
 * (and so said) once per person of the agent.
 */
export function updateAgentNote(el: HTMLElement, person: string | null): void {
    const note = el.querySelector<HTMLElement>('.tv-status-agent')!;
    const text = note.querySelector<HTMLElement>('.tv-status-agent-text')!;
    note.hidden = !person;
    if (!person) {
        delete note.dataset.person;
        text.textContent = '';
        return;
    }
    if (note.dataset.person === person) return;
    note.dataset.person = person;
    text.textContent = strings.table.agentRowHidden;
    note.title = strings.table.agentRowHidden;
}

/**
 * The research's state in the status line (§16.2), only while a research
 * column is shown, naming where the cells come from: "● Following the
 * research live", "● Agent and tasks from the running research" (its bridge
 * answers, not followed), else "Research: as of {when}" (the last load from
 * it); nothing otherwise.
 */
export function updateResearchStatus(el: HTMLElement, state: { live: true; followed: boolean } | { live: false; when: string } | null): void {
    const res = el.querySelector<HTMLElement>('.tv-status-res')!;
    const R = strings.table.res;
    const text = !state ? '' : state.live ? (state.followed ? R.following : R.fromBridge) : state.when ? R.stale(state.when) : '';
    res.hidden = !text;
    res.textContent = text;
    res.title = text;
    res.classList.toggle('is-following', !!state?.live);
}
