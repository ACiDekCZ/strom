/**
 * The choice of a family line (spec 026 P3 §2.3): the data and the markup of
 * the "Line X ▾" button of the whole tree's pages. Pure: no DOM, no app state.
 *
 * The items come in the order of the tree's introduction (largest line
 * first), framed by "Whole tree" at the top and "Other families" at the
 * bottom. The markup is a `<details class="sp-rodpick">`: it opens and its
 * links work without a script; the file's script and the app's window
 * (src/ui/rod-picker-ui.ts) add the search field's filter and the keys.
 */

import { LineageIndex, RodId, otherFamilyRods, rodLabels, rods } from './lineage.js';
import type { PageSet } from './family-pages.js';
import { sortRods } from './rods-overview.js';
import { countText } from './strings.js';

export interface RodPickerItem {
    /** A line, the whole tree or the other families. */
    id: RodId | 'tree' | 'other';
    label: string;
    /** The line's first and last year (none for the tree and the other families). */
    from: number | null;
    to: number | null;
    /** Members of a line, people of the tree, the small lines of the other families. */
    members: number;
    /** The spellings the search field matches besides the label. */
    forms: string[];
    /** The page in a set ('' or missing: none). */
    slug?: string;
}

/**
 * The items of the choice: "Whole tree", the lines (without the small ones),
 * "Other families" when there are any. With a set, its lines, labels, pages
 * and periods (`period`, else the line's own) in the set's order; without
 * one the tree's lines in the tree overview's size order (`sortRods`, ties by
 * the label in `lang`), so the choice and the overview list them alike.
 */
export function rodPickerItems(
    index: LineageIndex,
    set?: PageSet,
    period?: (id: RodId) => { from: number; to: number } | null,
    lang = 'en',
): RodPickerItem[] {
    const data = index.data;
    const persons = (set ? set.selection.personIds : Object.keys(data.persons))
        .filter(id => { const p = data.persons[id as keyof typeof data.persons]; return !!p && !p.isPlaceholder; }).length;
    const out: RodPickerItem[] = [{ id: 'tree', label: '', from: null, to: null, members: persons, forms: [], ...(set ? { slug: set.introSlug } : {}) }];
    const labels = set ? set.rodLabels : rodLabels(index);
    const ids = set ? set.rodIds : sortRods(rods(index).filter(r => !r.small), 'size', labels, lang).map(r => r.id);
    for (const id of ids) {
        const rod = index.rods.get(id);
        if (!rod) continue;
        const p = period ? period(id) : rod.period;
        out.push({
            id, label: labels.get(id) || rod.surname, from: p?.from ?? null, to: p?.to ?? null, members: rod.realMemberCount,
            forms: [...rod.forms, ...rod.otherForms], ...(set ? { slug: set.rodSlug.get(id) ?? '' } : {}),
        });
    }
    const other = set ? set.otherRodIds.length : otherFamilyRods(index).length;
    if (set ? !!set.otherSlug : other > 0) {
        out.push({ id: 'other', label: '', from: null, to: null, members: other, forms: [], ...(set ? { slug: set.otherSlug } : {}) });
    }
    return out;
}

/**
 * The small lines of "Other families" (spec 039 §1.4), alphabetically: the
 * rows the tree view's choice unfolds under "Other families".
 */
export function rodPickerSmallItems(index: LineageIndex, lang: string, labels: ReadonlyMap<RodId, string> = rodLabels(index)): RodPickerItem[] {
    return otherFamilyRods(index).map(rod => ({
        id: rod.id, label: labels.get(rod.id) || rod.surname, from: rod.period?.from ?? null, to: rod.period?.to ?? null,
        members: rod.realMemberCount, forms: [...rod.forms, ...rod.otherForms],
    })).sort((a, b) => a.label.localeCompare(b.label, lang));
}

/** Lower case without diacritics: the key the search field of the choice compares (as its script does). */
export function rodPickKey(text: string): string {
    return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

export interface RodPickerTexts {
    /** "Line" before the chosen line's name. */
    prefix: string;
    /** "Lines": the button on the introduction and the indexes. */
    all: string;
    wholeTree: string;
    other: string;
    placeholder: string;
    none: string;
    label: string;
    members: (n: number) => string;
}

export interface RodPickerMarkup {
    items: readonly RodPickerItem[];
    /** The line of the page (its breadcrumbs'), 'other', or null (the introduction, the indexes). */
    current: RodId | 'other' | null;
    /** The tree's name beside "Whole tree". */
    treeTitle: string;
    /** The axis of the bars (the introduction's). */
    lo: number;
    hi: number;
    texts: RodPickerTexts;
    /** A link to an item's page: an anchor in a file, a button in the app's window. */
    link: (item: RodPickerItem, inner: string, cls: string) => string;
    /**
     * "Other families": a link to its page ('link', the tree's pages) or a
     * button that unfolds the small lines (`small`) under it ('expand', the
     * tree view, spec 039 §1.4).
     */
    otherMode?: 'link' | 'expand';
    /** The small lines unfolded under "Other families" (otherMode 'expand'). */
    small?: readonly RodPickerItem[];
}

function esc(text: string): string {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** The button's text: "Line <b>X</b>", "Other families" or "Lines". */
export function rodPickSummaryHtml(m: Pick<RodPickerMarkup, 'items' | 'current' | 'texts' | 'small' | 'otherMode'>): string {
    const t = m.texts;
    if (m.current === 'other') return `<span class="sp-rodpick-v"><b>${esc(t.other)}</b></span>`;
    const item = m.current ? (m.items.find(i => i.id === m.current) ?? m.small?.find(i => i.id === m.current)) : undefined;
    if (!item) return `<span class="sp-rodpick-v">${esc(t.all)}</span>`;
    // The tree view's toolbar: the prefix in its own span, hidden where room is short (spec 039 §1.1).
    if (m.otherMode === 'expand') return `<span class="sp-rodpick-v"><span class="sp-rodpick-pfx">${esc(t.prefix)} </span><b>${esc(item.label)}</b></span>`;
    return `<span class="sp-rodpick-v">${esc(t.prefix)} <b>${esc(item.label)}</b></span>`;
}

/** The choice (§2.3): `<details>` with the button, the search field (script only) and the list of links. */
export function rodPickerHtml(m: RodPickerMarkup): string {
    const t = m.texts;
    const span = Math.max(1, m.hi - m.lo);
    const rows = m.items.map(item => {
        const on = item.id === m.current;
        const cur = on ? ' aria-current="true"' : '';
        if (item.id === 'tree') {
            const inner = `<span class="sp-rodpick-n"><b>${esc(t.wholeTree)}</b>${m.treeTitle ? ` <span class="sp-rodpick-sub">${esc(m.treeTitle)}</span>` : ''}</span>`
                + `<span class="sp-rodpick-c">${esc(t.members(item.members))}</span>`;
            // The tree view (§1.3): without a chosen line the whole tree is the current row.
            const whole = m.otherMode === 'expand' && m.current === null ? ' aria-current="true"' : '';
            return `<li class="sp-rodpick-tree sel-opt" data-sel-form="row" data-rod="tree"${whole}>${m.link(item, inner, 'sp-rodpick-a')}</li>`;
        }
        if (item.id === 'other') {
            const inner = `<span class="sp-rodpick-n">${esc(t.other)}</span><span class="sp-rodpick-c">${countText(item.members)}</span>`;
            if (m.otherMode === 'expand') {
                // §1.4: a button unfolding the small lines, each a row of its own (the current one marked).
                const smalls = (m.small ?? []).map(s => {
                    const sOn = s.id === m.current;
                    const years = s.from !== null && s.to !== null ? (s.from === s.to ? `${s.from}` : `${s.from}–${s.to}`) : '';
                    const sInner = `<span class="sp-rodpick-n">${esc(s.label)}${years ? ` <span class="sp-rodpick-sub">${esc(years)}</span>` : ''}</span>`
                        + `<span class="sp-rodpick-c">${countText(s.members)}</span>`;
                    return `<li class="sp-rodpick-small sel-opt${sOn ? ' is-cur' : ''}" data-sel-form="row" data-rod="${esc(s.id)}" data-q="${esc(rodPickKey([s.label, ...s.forms].join(' ')))}"`
                        + `${sOn ? ' aria-current="true"' : ''} hidden>${m.link(s, sInner, 'sp-rodpick-a')}</li>`;
                }).join('');
                const xInner = `<span class="sp-rodpick-n">${esc(t.other)} <span class="sp-rodpick-xchev" aria-hidden="true">▸</span></span>`
                    + `<span class="sp-rodpick-c">${countText(item.members)}</span>`;
                return `<li class="sp-rodpick-other sel-opt" data-sel-form="row" data-rod="other"><button type="button" class="sp-rodpick-x" aria-expanded="false">${xInner}</button></li>${smalls}`;
            }
            return `<li class="sp-rodpick-other sel-opt${on ? ' is-cur' : ''}" data-sel-form="row" data-rod="other"${cur}>${m.link(item, inner, 'sp-rodpick-a')}</li>`;
        }
        const bar = item.from !== null && item.to !== null
            ? `<span class="sp-rodpick-bar" aria-hidden="true"><span style="left:${((item.from - m.lo) / span * 100).toFixed(1)}%;width:${Math.max(2, (item.to - item.from) / span * 100).toFixed(1)}%"></span></span>`
            : '<span class="sp-rodpick-bar" aria-hidden="true"></span>';
        const key = rodPickKey([item.label, ...item.forms].join(' '));
        const inner = `<span class="sp-rodpick-n">${esc(item.label)}</span>${bar}<span class="sp-rodpick-c">${countText(item.members)}</span>`;
        return `<li class="sp-rodpick-rod sel-opt${on ? ' is-cur' : ''}" data-sel-form="row" data-rod="${esc(item.id)}" data-q="${esc(key)}"${cur}>${m.link(item, inner, 'sp-rodpick-a')}</li>`;
    }).join('');
    const mode = m.otherMode === 'expand' ? ' data-other-mode="expand"' : '';
    return `<details class="sp-rodpick" data-pfx="${esc(t.prefix)}" data-all="${esc(t.all)}" data-other="${esc(t.other)}"${mode}>`
        + `<summary class="sp-rodpick-btn" aria-label="${esc(t.label)}">${rodPickSummaryHtml(m)}<span class="sp-rodpick-chev" aria-hidden="true">▾</span></summary>`
        + `<div class="sp-rodpick-pop"><div class="sp-rodpick-f js-only"><input class="sp-rodpick-q" type="search" placeholder="${esc(t.placeholder)}"`
        + ` aria-label="${esc(t.placeholder)}" autocomplete="off" spellcheck="false"></div>`
        + `<ul class="sp-rodpick-list">${rows}</ul><p class="sp-rodpick-none" hidden>${esc(t.none)}</p></div></details>`;
}

// ---------------------------------------------------------------------------
// The window's selection (spec 098 §2): one choice of a family line, the
// ancestors or descendants of a person, a research line or a list of people.
// The tree view's toolbar, the pill's label and the phone's sheet show it;
// the saved family pages keep rodPickerHtml above.

/** The icons of the selection's rows (inline SVG in currentColor, hidden from assistive technology). */
const SEL_ICON_PATHS = {
    none: '<circle cx="12" cy="12" r="8"/>',
    rod: '<circle cx="12" cy="5" r="2.5"/><circle cx="6" cy="18" r="2.5"/><circle cx="18" cy="18" r="2.5"/><path d="M12 7.5v4M12 11.5 6 15.5M12 11.5l6 4"/>',
    ancestors: '<path d="M12 19V5"/><path d="M6 11l6-6 6 6"/>',
    descendants: '<path d="M12 5v14"/><path d="M6 13l6 6 6-6"/>',
    line: '<path d="M4 20 10 12l4 4 6-10"/>',
} as const;

export type SelectionIconKind = keyof typeof SEL_ICON_PATHS;

export function selectionIcon(kind: SelectionIconKind): string {
    return `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${SEL_ICON_PATHS[kind]}</svg>`;
}

/** A row of the choice beyond the family lines: ancestors, descendants, a research line, a list. */
export interface SelectionPickRow {
    /** The encoded selection (encodeSelectionRef): the row's data-sel. */
    sel: string;
    label: string;
    /** The quiet line under the name ("person in focus", the list's kind). */
    sub?: string;
    count: number;
    /** The row's icon (trusted markup). */
    icon: string;
    /** The search key (rodPickKey); none: a query hides the row. */
    q?: string;
    current?: boolean;
}

export interface SelectionPickerTexts {
    button: string;
    pickLabel: string;
    search: string;
    none: string;
    noneSub: string;
    secRods: string;
    secPerson: string;
    secPersons: string;
    secLines: string;
    secLists: string;
    otherPerson: string;
    current: string;
    person: (n: string) => string;
    changePerson: string;
    generations: string;
    genAll: string;
    noLists: string;
    noMatch: { rods: string; lines: string; lists: string; persons: string };
    saveList: string;
    manage: string;
    /** "Other families" (the small lines). */
    other: string;
    members: (n: number) => string;
    fewer: string;
    more: string;
}

export interface SelectionPickerMarkup {
    /** The window's selection as the button names it (null: none). */
    label: { prefix: string; name: string } | null;
    /** The encoded current selection ('' none). */
    current: string;
    /** People of the tree (the row "No selection"). */
    treeCount: number;
    /** The section of family lines (null: the tree has none worth choosing). */
    rods: { items: readonly RodPickerItem[]; small: readonly RodPickerItem[]; lo: number; hi: number } | null;
    /** The ancestors and descendants of the person in focus (none: no person in focus). */
    focus: readonly SelectionPickRow[];
    /** The research lines (none: the section is left out). */
    lines: readonly SelectionPickRow[];
    lists: readonly SelectionPickRow[];
    /** The block "Window selection" (ancestors or descendants chosen): the person and the generations. */
    block?: { title: string; count: number; person: string; generations?: number } | null;
    /** "Save the selection as a list…" offered (a selection that is not a list, lists that can change). */
    canSave: boolean;
    texts: SelectionPickerTexts;
}

/** The button's text: "Selection", or the selection's prefix (hidden where room is short) and name. */
export function selectionPickSummaryHtml(label: SelectionPickerMarkup['label'], texts: Pick<SelectionPickerTexts, 'button'>): string {
    if (!label || !label.name) return `<span class="sp-rodpick-v">${esc(texts.button)}</span>`;
    const pfx = label.prefix ? `<span class="sp-rodpick-pfx">${esc(label.prefix)} </span>` : '';
    return `<span class="sp-rodpick-v">${pfx}<b>${esc(label.name)}</b></span>`;
}

function selRowHtml(r: SelectionPickRow, sec: string, extraCls = '', extraAttr = ''): string {
    const sub = r.sub ? `<small class="sp-selpick-sub">${esc(r.sub)}</small>` : '';
    const inner = `<span class="sp-selpick-ic" aria-hidden="true">${r.icon}</span><span class="sp-rodpick-n">${esc(r.label)}${sub}</span>`
        + `<span class="sp-rodpick-c">${countText(r.count)}</span>`;
    const q = r.q !== undefined ? ` data-q="${esc(r.q)}"` : '';
    const cur = r.current ? ' aria-current="true"' : '';
    return `<li class="sp-selpick-row sel-opt${r.current ? ' is-cur' : ''}${extraCls}" data-sel-form="row" data-sec="${sec}"${extraAttr} data-sel="${esc(r.sel)}"${q}${cur}>`
        + `<button type="button" class="sp-rodpick-a">${inner}</button></li>`;
}

/**
 * The rows of people found by a query ("Ancestors: X", "Descendants: X"):
 * put under the section People; with `sec` 'focus' another person's rows in
 * the section Ancestors and descendants.
 */
export function selectionFoundRowsHtml(rows: readonly SelectionPickRow[], sec: 'persons' | 'focus' = 'persons'): string {
    return rows.map(r => (sec === 'persons'
        ? selRowHtml({ ...r, q: undefined }, sec, ' sp-selpick-found', ' data-found=""')
        : selRowHtml({ ...r, q: undefined }, sec))).join('');
}

function secHead(sec: string, title: string, link = ''): string {
    return `<li class="sp-selpick-sh" data-sec="${sec}" role="presentation"><span>${esc(title)}</span>${link}</li>`;
}

function secNone(sec: string, noMatch: string, empty = ''): string {
    return `<li class="sp-selpick-none" data-sec="${sec}" data-none="${esc(noMatch)}"${empty ? ` data-empty="${esc(empty)}"` : ' hidden'}>${esc(empty)}</li>`;
}

/**
 * The choice of the window's selection (§2, 2a–2e): the search field, the
 * block "Window selection" (ancestors or descendants: the person and the
 * generations), "No selection", the sections Family lines (bars, "Other
 * families ▸" unfolding the small ones), People (filled by a query),
 * Ancestors and descendants (the person in focus, "Another person…"),
 * Research lines (only with lines), Lists of people (an empty one says so),
 * and the footer ("Save the selection as a list…", "Lists of people…").
 * Each row carries its selection in `data-sel` ('none': no selection).
 */
export function selectionPickerHtml(m: SelectionPickerMarkup): string {
    const t = m.texts;
    const rows: string[] = [];
    const noneOn = !m.current;
    rows.push(`<li class="sp-rodpick-tree sel-opt" data-sel-form="row" data-sel="none"${noneOn ? ' aria-current="true"' : ''}>`
        + `<button type="button" class="sp-rodpick-a"><span class="sp-selpick-ic" aria-hidden="true">${selectionIcon('none')}</span>`
        + `<span class="sp-rodpick-n">${esc(t.none)}<small class="sp-selpick-sub">${esc(t.noneSub)}</small></span>`
        + `<span class="sp-rodpick-c">${countText(m.treeCount)}</span></button></li>`);
    if (m.rods) {
        const { lo, hi } = m.rods;
        const span = Math.max(1, hi - lo);
        rows.push(secHead('rods', t.secRods));
        const rodIc = `<span class="sp-selpick-ic" aria-hidden="true">${selectionIcon('rod')}</span>`;
        for (const item of m.rods.items) {
            if (item.id === 'tree' || item.id === 'other') continue;
            const sel = `rod:${encodeURIComponent(item.id)}`;
            const on = sel === m.current;
            const bar = item.from !== null && item.to !== null
                ? `<span class="sp-rodpick-bar" aria-hidden="true"><span style="left:${((item.from - lo) / span * 100).toFixed(1)}%;width:${Math.max(2, (item.to - item.from) / span * 100).toFixed(1)}%"></span></span>`
                : '<span class="sp-rodpick-bar" aria-hidden="true"></span>';
            const key = rodPickKey([item.label, ...item.forms].join(' '));
            rows.push(`<li class="sp-rodpick-rod sel-opt${on ? ' is-cur' : ''}" data-sel-form="row" data-sec="rods" data-rod="${esc(item.id)}" data-sel="${esc(sel)}" data-q="${esc(key)}"${on ? ' aria-current="true"' : ''}>`
                + `<button type="button" class="sp-rodpick-a">${rodIc}<span class="sp-rodpick-n">${esc(item.label)}</span>${bar}<span class="sp-rodpick-c">${countText(item.members)}</span></button></li>`);
        }
        const other = m.rods.items.find(i => i.id === 'other');
        if (other && m.rods.small.length) {
            const xInner = `<span class="sp-selpick-ic" aria-hidden="true"></span><span class="sp-rodpick-n">${esc(t.other)} <span class="sp-rodpick-xchev" aria-hidden="true">▸</span></span>`
                + `<span class="sp-rodpick-c">${other.members}</span>`;
            rows.push(`<li class="sp-rodpick-other sel-opt" data-sel-form="row" data-sec="rods" data-rod="other"><button type="button" class="sp-rodpick-x" aria-expanded="false">${xInner}</button></li>`);
            for (const s of m.rods.small) {
                const sel = `rod:${encodeURIComponent(s.id)}`;
                const on = sel === m.current;
                const years = s.from !== null && s.to !== null ? (s.from === s.to ? `${s.from}` : `${s.from}–${s.to}`) : '';
                rows.push(`<li class="sp-rodpick-small sel-opt${on ? ' is-cur' : ''}" data-sel-form="row" data-sec="rods" data-rod="${esc(s.id)}" data-sel="${esc(sel)}"`
                    + ` data-q="${esc(rodPickKey([s.label, ...s.forms].join(' ')))}"${on ? ' aria-current="true"' : ''} hidden>`
                    + `<button type="button" class="sp-rodpick-a"><span class="sp-rodpick-n">${esc(s.label)}${years ? ` <span class="sp-rodpick-sub">${esc(years)}</span>` : ''}</span>`
                    + `<span class="sp-rodpick-c">${countText(s.members)}</span></button></li>`);
            }
        }
        rows.push(secNone('rods', t.noMatch.rods));
    }
    // People found by a query (wireRodPicker fills the rows after the head).
    rows.push(`<li class="sp-selpick-sh" data-sec="persons" role="presentation" hidden><span>${esc(t.secPersons)}</span></li>`);
    rows.push(`<li class="sp-selpick-none" data-sec="persons" data-none="${esc(t.noMatch.persons)}" hidden></li>`);
    rows.push(secHead('focus', t.secPerson, `<button type="button" class="sp-selpick-other">${esc(t.otherPerson)}</button>`));
    for (const r of m.focus) rows.push(selRowHtml({ ...r, q: undefined }, 'focus'));
    if (m.lines.length) {
        rows.push(secHead('lines', t.secLines));
        for (const r of m.lines) rows.push(selRowHtml(r, 'lines'));
        rows.push(secNone('lines', t.noMatch.lines));
    }
    rows.push(secHead('lists', t.secLists));
    for (const r of m.lists) rows.push(selRowHtml(r, 'lists'));
    rows.push(secNone('lists', t.noMatch.lists, m.lists.length ? '' : t.noLists));
    let block = '';
    if (m.block) {
        const b = m.block;
        const g = b.generations;
        block = `<div class="sp-selpick-cur" role="group" aria-label="${esc(t.current)}"><span class="sp-selpick-cur-t">${esc(t.current)}</span>`
            + `<span class="sp-selpick-cur-v">${esc(b.title)} <span class="sp-selpick-cur-c">· ${esc(t.members(b.count))}</span></span>`
            + `<span class="sp-selpick-cur-o"><span>${esc(t.person(''))}<b>${esc(b.person)}</b> · <button type="button" class="sp-selpick-change">${esc(t.changePerson)}</button></span>`
            + `<span class="depth-stepper sp-selpick-gen"><span class="depth-stepper-label">${esc(t.generations)}</span><span class="depth-stepper-group" role="group" aria-label="${esc(t.generations)}">`
            + `<button type="button" class="depth-stepper-btn" data-gen="-1" aria-label="${esc(t.fewer)}"${g === 1 ? ' disabled' : ''}>−</button>`
            + `<span class="depth-stepper-value" aria-live="polite">${g ? g : esc(t.genAll)}</span>`
            + `<button type="button" class="depth-stepper-btn" data-gen="1" aria-label="${esc(t.more)}"${g ? '' : ' disabled'}>+</button></span></span>`
            + `</span></div>`;
    }
    const foot = `<div class="sp-selpick-foot">${m.canSave ? `<button type="button" class="sp-rodpick-savebtn sp-selpick-save">${esc(t.saveList)}</button>` : ''}`
        + `<button type="button" class="sp-rodpick-savebtn sp-selpick-manage">${esc(t.manage)}</button></div>`;
    return `<details class="sp-rodpick sp-selpick" data-other-mode="expand">`
        + `<summary class="sp-rodpick-btn" aria-label="${esc(t.pickLabel)}">${selectionPickSummaryHtml(m.label, t)}<span class="sp-rodpick-chev" aria-hidden="true">▾</span></summary>`
        + `<div class="sp-rodpick-pop"><div class="sp-rodpick-f"><input class="sp-rodpick-q" type="search" placeholder="${esc(t.search)}"`
        + ` aria-label="${esc(t.search)}" autocomplete="off" spellcheck="false"></div>${block}`
        + `<ul class="sp-rodpick-list">${rows.join('')}</ul>${foot}</div></details>`;
}

/** What the filter of the sectioned choice knows of a row. */
export interface SelectionPickRowInfo {
    role: 'tree' | 'head' | 'none' | 'row' | 'small' | 'other' | 'found';
    sec: string;
    q?: string;
    /** A none row's text without a query (an empty section: "The tree has no lists yet."). */
    empty?: boolean;
}

/** What the filter does with a row: hidden, and for a none row which text it shows. */
export interface SelectionPickRowShow {
    hidden: boolean;
    text?: 'empty' | 'none';
}

/**
 * The search over the sections (§2, 2d), pure: `key` is rodPickKey of the
 * query. Without one every section shows (the small lines only unfolded, an
 * empty section its sentence, the People section none). With one, "No
 * selection" and the person in focus's section step aside; the rows whose key
 * holds the query show, "Other families" stays when a small line matched; the
 * found people show under People (`personsSearched`: the query was long enough
 * to look for people); a section without a hit says so.
 */
export function selectionPickFilter(rows: readonly SelectionPickRowInfo[], key: string, unfolded: boolean, personsSearched: boolean): SelectionPickRowShow[] {
    const hits = new Map<string, number>();
    const smallHits = new Map<string, number>();
    const match = (r: SelectionPickRowInfo): boolean => r.q !== undefined && r.q.includes(key);
    if (key) {
        for (const r of rows) {
            if ((r.role === 'row' || r.role === 'small') && match(r)) {
                hits.set(r.sec, (hits.get(r.sec) ?? 0) + 1);
                if (r.role === 'small') smallHits.set(r.sec, (smallHits.get(r.sec) ?? 0) + 1);
            } else if (r.role === 'found') hits.set(r.sec, (hits.get(r.sec) ?? 0) + 1);
        }
    }
    return rows.map((r): SelectionPickRowShow => {
        if (!key) {
            switch (r.role) {
                case 'small': return { hidden: !unfolded };
                case 'found': return { hidden: true };
                case 'none': return r.empty ? { hidden: false, text: 'empty' } : { hidden: true };
                case 'head': return { hidden: r.sec === 'persons' };
                default: return { hidden: false };
            }
        }
        if (r.sec === 'focus' || r.role === 'tree') return { hidden: true };
        if (r.sec === 'persons' && !personsSearched) return { hidden: true };
        switch (r.role) {
            case 'head': return { hidden: false };
            case 'none': return (hits.get(r.sec) ?? 0) > 0 ? { hidden: true } : { hidden: false, text: 'none' };
            case 'other': return { hidden: (smallHits.get(r.sec) ?? 0) === 0 };
            case 'found': return { hidden: false };
            default: return { hidden: !match(r) };
        }
    });
}
