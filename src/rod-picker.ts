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
 * and periods (`period`, else the line's own); without one the tree's.
 */
export function rodPickerItems(
    index: LineageIndex,
    set?: PageSet,
    period?: (id: RodId) => { from: number; to: number } | null,
): RodPickerItem[] {
    const data = index.data;
    const persons = (set ? set.selection.personIds : Object.keys(data.persons))
        .filter(id => { const p = data.persons[id as keyof typeof data.persons]; return !!p && !p.isPlaceholder; }).length;
    const out: RodPickerItem[] = [{ id: 'tree', label: '', from: null, to: null, members: persons, forms: [], ...(set ? { slug: set.introSlug } : {}) }];
    const labels = set ? set.rodLabels : rodLabels(index);
    const ids = set ? set.rodIds : rods(index).filter(r => !r.small).map(r => r.id);
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
            return `<li class="sp-rodpick-tree" data-rod="tree"${whole}>${m.link(item, inner, 'sp-rodpick-a')}</li>`;
        }
        if (item.id === 'other') {
            const inner = `<span class="sp-rodpick-n">${esc(t.other)}</span><span class="sp-rodpick-c">${item.members}</span>`;
            if (m.otherMode === 'expand') {
                // §1.4: a button unfolding the small lines, each a row of its own (the current one marked).
                const smalls = (m.small ?? []).map(s => {
                    const sOn = s.id === m.current;
                    const years = s.from !== null && s.to !== null ? (s.from === s.to ? `${s.from}` : `${s.from}–${s.to}`) : '';
                    const sInner = `<span class="sp-rodpick-n">${esc(s.label)}${years ? ` <span class="sp-rodpick-sub">${esc(years)}</span>` : ''}</span>`
                        + `<span class="sp-rodpick-c">${s.members}</span>`;
                    return `<li class="sp-rodpick-small${sOn ? ' is-cur' : ''}" data-rod="${esc(s.id)}" data-q="${esc(rodPickKey([s.label, ...s.forms].join(' ')))}"`
                        + `${sOn ? ' aria-current="true"' : ''} hidden>${m.link(s, sInner, 'sp-rodpick-a')}</li>`;
                }).join('');
                const xInner = `<span class="sp-rodpick-n">${esc(t.other)} <span class="sp-rodpick-xchev" aria-hidden="true">▸</span></span>`
                    + `<span class="sp-rodpick-c">${item.members}</span>`;
                return `<li class="sp-rodpick-other" data-rod="other"><button type="button" class="sp-rodpick-x" aria-expanded="false">${xInner}</button></li>${smalls}`;
            }
            return `<li class="sp-rodpick-other${on ? ' is-cur' : ''}" data-rod="other"${cur}>${m.link(item, inner, 'sp-rodpick-a')}</li>`;
        }
        const bar = item.from !== null && item.to !== null
            ? `<span class="sp-rodpick-bar" aria-hidden="true"><span style="left:${((item.from - m.lo) / span * 100).toFixed(1)}%;width:${Math.max(2, (item.to - item.from) / span * 100).toFixed(1)}%"></span></span>`
            : '<span class="sp-rodpick-bar" aria-hidden="true"></span>';
        const key = rodPickKey([item.label, ...item.forms].join(' '));
        const inner = `<span class="sp-rodpick-n">${esc(item.label)}</span>${bar}<span class="sp-rodpick-c">${item.members}</span>`;
        return `<li class="sp-rodpick-rod${on ? ' is-cur' : ''}" data-rod="${esc(item.id)}" data-q="${esc(key)}"${cur}>${m.link(item, inner, 'sp-rodpick-a')}</li>`;
    }).join('');
    const mode = m.otherMode === 'expand' ? ' data-other-mode="expand"' : '';
    return `<details class="sp-rodpick" data-pfx="${esc(t.prefix)}" data-all="${esc(t.all)}" data-other="${esc(t.other)}"${mode}>`
        + `<summary class="sp-rodpick-btn" aria-label="${esc(t.label)}">${rodPickSummaryHtml(m)}<span class="sp-rodpick-chev" aria-hidden="true">▾</span></summary>`
        + `<div class="sp-rodpick-pop"><div class="sp-rodpick-f js-only"><input class="sp-rodpick-q" type="search" placeholder="${esc(t.placeholder)}"`
        + ` aria-label="${esc(t.placeholder)}" autocomplete="off" spellcheck="false"></div>`
        + `<ul class="sp-rodpick-list">${rows}</ul><p class="sp-rodpick-none" hidden>${esc(t.none)}</p></div></details>`;
}
