/**
 * The marriage-order pill and the card's hidden-relatives tabs measured in the
 * browser (T13): hidden copies with the screen's own classes, so the layout of
 * the pill and the tabs (placeUnionOrderPill) and the image export's pill use
 * the widths the screen draws. Cached once the pill font is in; measured
 * before that, the values are used but not kept (pillFontsPending says when to
 * measure again).
 */

import { PillMetrics, BranchTab, estimatePillMetrics, branchTabKind, branchTabRelation } from './marriage-order.js';
import { strings } from './strings.js';

/** The face of the pill and tab texts (index.html: 600 10px var(--font-sans)). */
const PILL_FACE = '600 10px "Instrument Sans"';

const pillCache = new Map<string, PillMetrics>();
const tabCache = new Map<string, number>();
let pending: Promise<void> | null = null;
let settled = false;

function fontsReady(): boolean {
    const fonts = typeof document !== 'undefined' ? document.fonts : undefined;
    if (settled || !fonts?.check) return true;
    try {
        return fonts.check(PILL_FACE);
    } catch {
        return true;
    }
}

/** Null when the pill font is in; otherwise a promise that settles once it loads. */
export function pillFontsPending(): Promise<void> | null {
    if (fontsReady()) return null;
    if (!pending) {
        pending = document.fonts.load(PILL_FACE).then(() => undefined, () => undefined)
            .finally(() => { pending = null; settled = true; });
    }
    return pending;
}

const escapeHtml = (s: string): string =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * The visible inside of a pill: its number, the ∞ and the year (the screen's
 * markup); `glyph` false: the ordinal alone (the shortest label).
 */
export function unionOrderPillPartsHtml(ordinal: string, year: string, glyph = true): string {
    if (!glyph) return `<span class="uo-num">${escapeHtml(ordinal)}</span>`;
    return `<span class="uo-num">${escapeHtml(ordinal)}</span>`
        + `<span class="pill-glyph uo-glyph">∞</span>`
        + (year ? `<span class="uo-year">${escapeHtml(year)}</span>` : '');
}

/**
 * The glyph of a top-edge tab: the kind of its click, not the relation —
 * "▸" shows in place ("▾" while shown), "◎" focuses, "↗" (at the end of the
 * word) moves the view to a card drawn elsewhere.
 */
export function tabGlyph(tab: BranchTab): string {
    if (tab === 'parentsShown' || tab === 'siblingsShown' || tab === 'childrenShown') return '▾';
    const kind = branchTabKind(tab);
    return kind === 'focus' ? '◎' : kind === 'jump' ? '↗' : '▸';
}

/** The word of a card's top-edge tab (a hidden-relatives tab or a line link). */
export function tabLabel(kind: BranchTab): string {
    switch (kind) {
        case 'parents':
        case 'parentsHere':
        case 'parentsShown':
        case 'parentsFolded': return strings.focus.branchTabParents;
        case 'family': return strings.focus.branchTabFamily;
        case 'siblings':
        case 'siblingsHere':
        case 'siblingsShown': return strings.focus.branchTabSiblings;
        case 'children':
        case 'childrenShown': return strings.focus.branchTabChildren;
        case 'linkParents': return strings.focus.linkTabParents;
        case 'linkChild': return strings.focus.linkTabChild;
        case 'linkChildren': return strings.focus.linkTabChildren;
    }
}

/**
 * The letter of a tab in the short form (a card whose words do not fit):
 * the relation's (cs R/S/D, en P/S/C, de E/G/K); a focus tab none — a card
 * has one focus tab at most, its "◎" says it.
 */
export function tabShort(tab: BranchTab): string {
    return branchTabKind(tab) === 'focus' ? '' : strings.focus.branchTabShort[branchTabRelation(tab)];
}

/** The class of a top-edge tab's kind (index.html: .kind-place, .kind-focus, .kind-jump). */
export function tabKindClass(tab: BranchTab): string {
    return `kind-${branchTabKind(tab)}`;
}

/** The gap between a tab and its bubble with the bubble's arrow (index.html .badge-tooltip margin). */
const BUBBLE_GAP = 12;

/**
 * Whether a tab's bubble opens below the tab instead of above it: only when
 * the room above (from the tab's top up to the bars over the tree) is too
 * small for the bubble and the room below (down to the tree's bottom) is
 * larger. Screen pixels, the zoom included.
 */
export function bubbleOpensBelow(tab: { top: number; bottom: number }, bubbleHeight: number, roomTop: number, roomBottom: number): boolean {
    const above = tab.top - roomTop;
    if (above >= bubbleHeight + BUBBLE_GAP) return false;
    return roomBottom - tab.bottom > above;
}

/** The gap between a card and a bubble beside it with the bubble's arrow (index.html .badge-tooltip.beside-*). */
export const BUBBLE_SIDE_GAP = 10;

/** Where a tab's bubble opens: above the tab, beside the card (right, left) or below the tab. */
export type BubblePlace = 'above' | 'right' | 'left' | 'below';

/**
 * Where a tab's bubble opens (screen pixels, the zoom included; `room` the
 * visible tree under the bars over it): above the tab while it fits there;
 * else beside the card, its top edge at the card's top, on the right where
 * it fits, else on the left; only when it fits on neither side, below the
 * tab while it fits there whole. A bubble that fits neither above nor below
 * the tab nor beside the card at its top (a low screen: a phone held
 * sideways, a small window) still goes beside the card where the tree is
 * tall enough for it, moved up as far as it needs (besideTop); only then
 * below the tab where the room below is larger than above
 * (bubbleOpensBelow), else above all the same.
 */
export function bubblePlacement(
    tab: { top: number; bottom: number },
    card: { left: number; right: number; top: number },
    bubble: { width: number; height: number },
    room: { top: number; bottom: number; left: number; right: number },
    opts: { touch?: boolean } = {},
): BubblePlace {
    // Touch (round 3 §22): below the tab, never beside the card (the finger
    // came from above); above only where it fits there and not below.
    if (opts.touch) {
        if (room.bottom - tab.bottom >= bubble.height + BUBBLE_GAP) return 'below';
        return tab.top - room.top >= bubble.height + BUBBLE_GAP ? 'above' : 'below';
    }
    if (tab.top - room.top >= bubble.height + BUBBLE_GAP) return 'above';
    const side = (): BubblePlace | null => {
        if (card.right + BUBBLE_SIDE_GAP + bubble.width <= room.right) return 'right';
        if (card.left - BUBBLE_SIDE_GAP - bubble.width >= room.left) return 'left';
        return null;
    };
    if (card.top >= room.top && card.top + bubble.height <= room.bottom) {
        const at = side();
        if (at) return at;
    }
    if (room.bottom - tab.bottom >= bubble.height + BUBBLE_GAP) return 'below';
    if (bubble.height <= room.bottom - room.top) {
        const at = side();
        if (at) return at;
    }
    return bubbleOpensBelow(tab, bubble.height, room.top, room.bottom) ? 'below' : 'above';
}

/** The margin a bubble moved up beside the card keeps from the tree's bottom (the card grows a little under the pointer). */
const BUBBLE_EDGE_GAP = 4;

/**
 * The top edge of a bubble beside the card (bubblePlacement 'right'/'left'):
 * the card's top, unless the bubble would then reach under the tree's
 * bottom or start under the bars; then as low as it still fits whole.
 */
export function besideTop(cardTop: number, bubbleHeight: number, room: { top: number; bottom: number }): number {
    return Math.max(room.top, Math.min(cardTop, room.bottom - BUBBLE_EDGE_GAP - bubbleHeight));
}

/** The margin a bubble keeps from the window's edges: it stands whole in the window (round 3 §24). */
export const BUBBLE_WINDOW_MARGIN = 8;

/** The CSS gap between a tab and its bubble above or below it (index.html .badge-tooltip margin; the arrow reaches into it). */
const BUBBLE_TAB_MARGIN = 8;

/** Where a bubble's arrow stays from the bubble's corners (its rounded border). */
const BUBBLE_ARROW_INSET = 12;

/** Where a bubble beside the card points its arrow: this far under the card's top (index.html .beside-*::after). */
export const BUBBLE_SIDE_ARROW_TOP = 14;

/** Where a bubble stands on the screen: its top-left corner and where its arrow points. */
export interface BubbleBox {
    left: number;
    top: number;
    /** Above or below the tab: the arrow's distance from the bubble's left edge; beside the card: how far under BUBBLE_SIDE_ARROW_TOP it points. */
    arrow: number;
}

/**
 * Where a tab's bubble stands on the screen in its place (bubblePlacement;
 * screen pixels; the bubble at scale 1, whatever the zoom): above or below
 * the tab, centred on it; beside the card at its top (besideTop). Then moved
 * into the window, BUBBLE_WINDOW_MARGIN from each edge (a bubble wider or
 * taller than the window keeps its left or top edge there). The arrow keeps
 * pointing at the tab's middle (at the card's top beside the card) as far as
 * the bubble's edge allows.
 */
export function bubbleBox(
    place: BubblePlace,
    tab: { left: number; right: number; top: number; bottom: number },
    card: { left: number; right: number; top: number },
    bubble: { width: number; height: number },
    room: { top: number; bottom: number },
    viewport: { width: number; height: number },
): BubbleBox {
    const m = BUBBLE_WINDOW_MARGIN;
    const tabMid = (tab.left + tab.right) / 2;
    let left: number, top: number;
    if (place === 'right' || place === 'left') {
        left = place === 'right' ? card.right + BUBBLE_SIDE_GAP : card.left - BUBBLE_SIDE_GAP - bubble.width;
        top = besideTop(card.top, bubble.height, room);
    } else {
        left = tabMid - bubble.width / 2;
        top = place === 'above' ? tab.top - BUBBLE_TAB_MARGIN - bubble.height : tab.bottom + BUBBLE_TAB_MARGIN;
    }
    left = Math.max(m, Math.min(left, viewport.width - m - bubble.width));
    top = Math.max(m, Math.min(top, viewport.height - m - bubble.height));
    const arrow = place === 'right' || place === 'left'
        ? Math.max(0, Math.min(card.top - top, bubble.height - 2 * BUBBLE_SIDE_ARROW_TOP))
        : Math.max(BUBBLE_ARROW_INSET, Math.min(tabMid - left, bubble.width - BUBBLE_ARROW_INSET));
    return { left, top, arrow };
}

/** The most names a tab's bubble lists; the rest is one line "and n more" (the menu and the sheet list them all). */
export const BUBBLE_MAX_NAMES = 8;

/**
 * How many names of each group a tab's bubble lists (siblings by union,
 * children by marriage, a family's parents and siblings): all of them up to
 * `max` in total; above it each group in proportion to its size, every group
 * with names keeps at least one (while there are fewer groups than `max`;
 * else the first `max` groups one each), the sum exactly `max`. Deterministic:
 * the largest remainder gets a free place first, the earlier group on a tie;
 * a place taken back comes from the largest share, the later group on a tie.
 */
export function bubbleNameCounts(sizes: readonly number[], max = BUBBLE_MAX_NAMES): number[] {
    const total = sizes.reduce((a, b) => a + b, 0);
    if (total <= max) return [...sizes];
    const groups = sizes.map((n, i) => ({ n, i })).filter(g => g.n > 0);
    const out = sizes.map(() => 0);
    if (groups.length >= max) {
        for (const g of groups.slice(0, max)) out[g.i] = 1;
        return out;
    }
    for (const g of groups) out[g.i] = Math.min(g.n, Math.max(1, Math.floor(max * g.n / total)));
    let sum = out.reduce((a, b) => a + b, 0);
    while (sum > max) {
        let at = -1;
        for (const g of groups) if (out[g.i] > 1 && (at < 0 || out[g.i] >= out[at])) at = g.i;
        out[at]--;
        sum--;
    }
    while (sum < max) {
        let at = -1;
        let best = -Infinity;
        for (const g of groups) {
            if (out[g.i] >= g.n) continue;
            const rest = max * g.n / total - out[g.i];
            if (rest > best) { best = rest; at = g.i; }
        }
        out[at]++;
        sum++;
    }
    return out;
}

/**
 * The resting look of a top-edge tab (no bubble): its glyph, its word (kept
 * for screen readers when the card shortens its tabs) and its short letter
 * (shown only then). A jump's "↗" stands after the word.
 */
export function branchTabRestHtml(kind: BranchTab): string {
    const glyph = `<span class="pill-glyph">${tabGlyph(kind)}</span>`;
    const short = tabShort(kind);
    const words = `<span class="pill-text">${escapeHtml(tabLabel(kind))}</span>`
        + (short ? `<span class="pill-short" aria-hidden="true">${escapeHtml(short)}</span>` : '');
    return branchTabKind(kind) === 'jump' ? words + glyph : glyph + words;
}

function hiddenHost(): HTMLElement {
    const host = document.createElement('div');
    host.setAttribute('aria-hidden', 'true');
    host.style.cssText = 'position:absolute;left:-100000px;top:0;visibility:hidden;pointer-events:none;contain:layout style;';
    return host;
}

const pillKey = (ordinal: string, year: string, glyph = true): string => `${ordinal}\u0000${year}\u0000${glyph ? 1 : 0}`;

/**
 * Pills measured in the screen's markup and styles, in the font the screen
 * really draws (whatever the platform gives): their widths and where their
 * parts sit. One hidden batch for the ones not cached yet; without a
 * document, the estimate. `glyph` false: the ordinal alone.
 */
export function measureUnionOrderPills(items: Iterable<{ ordinal: string; year: string; glyph?: boolean }>): Map<string, PillMetrics> {
    const out = new Map<string, PillMetrics>();
    const todo: Array<{ ordinal: string; year: string; glyph: boolean; key: string }> = [];
    for (const { ordinal, year, glyph = true } of items) {
        const key = pillKey(ordinal, year, glyph);
        if (out.has(key)) continue;
        const hit = pillCache.get(key);
        if (hit) out.set(key, hit);
        else { out.set(key, estimatePillMetrics(ordinal, year, glyph)); todo.push({ ordinal, year, glyph, key }); }
    }
    if (todo.length === 0 || typeof document === 'undefined' || !document.body) return out;
    const host = hiddenHost();
    const els = todo.map(t => {
        const wrap = document.createElement('div');
        wrap.style.cssText = 'display:block;width:max-content;';
        wrap.innerHTML = `<span class="union-order-pill">${unionOrderPillPartsHtml(t.ordinal, t.year, t.glyph)}</span>`;
        host.appendChild(wrap);
        return wrap.firstElementChild as HTMLElement;
    });
    document.body.appendChild(host);
    const cache = fontsReady();
    todo.forEach((t, i) => {
        const pill = els[i];
        const r = pill.getBoundingClientRect();
        const part = (sel: string) => pill.querySelector(sel)?.getBoundingClientRect();
        const num = part('.uo-num'), glyph = part('.uo-glyph'), year = part('.uo-year');
        if (!r.width || !num || (t.glyph && !glyph)) return;   // not laid out (no styles): keep the estimate
        const m: PillMetrics = {
            width: r.width,
            numX: num.left - r.left,
            glyphX: glyph ? glyph.left - r.left + glyph.width / 2 : 0,
            yearX: year ? year.left - r.left : 0,
        };
        out.set(t.key, m);
        if (cache) pillCache.set(t.key, m);
    });
    host.remove();
    return out;
}

/** One pill measured (see measureUnionOrderPills). */
export function measureUnionOrderPill(ordinal: string, year: string, glyph = true): PillMetrics {
    return measureUnionOrderPills([{ ordinal, year, glyph }]).get(pillKey(ordinal, year, glyph))!;
}

/** The key of a pill in measureUnionOrderPills' result. */
export { pillKey as unionOrderPillKey };

/**
 * How a card's top-edge tabs show (the whole card at once): their words
 * ("full"), their glyphs with a letter each ("short", .tabs-short), or their
 * glyphs alone ("glyph", .tabs-glyph: not even the letters fit). Far out
 * (below the zoom's ZOOM_FAR) the screen shows the glyphs alone anyway
 * (index.html: #tree-canvas.zoom-far).
 */
export type TabsForm = 'full' | 'short' | 'glyph';

/** The key of a row of tabs in measureTabRows' result (its words: the language's; `form`: how the row shows). */
export function rowKey(kinds: readonly BranchTab[], form: TabsForm = 'full'): string {
    return kinds.map(k => `${k}:${tabLabel(k)}:${tabShort(k)}`).join(',') + (form === 'full' ? '' : `|${form}`);
}

/** The class of a row of tabs in this form ('' for the words). */
export function tabsFormClass(form: TabsForm): string {
    return form === 'full' ? '' : `tabs-${form}`;
}

/**
 * Widths of rows of resting top-edge tabs (hidden relatives, line links; 4px apart, as on the card's
 * top edge), one per distinct row; 0 for an empty row. `form`: the rows of a card whose tabs show
 * shortened (tabsForm).
 */
export function measureTabRows(rows: Iterable<readonly BranchTab[]>, form: TabsForm = 'full'): Map<string, number> {
    const out = new Map<string, number>();
    const todo: Array<{ key: string; kinds: readonly BranchTab[] }> = [];
    for (const kinds of rows) {
        const key = rowKey(kinds, form);
        if (out.has(key)) continue;
        if (kinds.length === 0) { out.set(key, 0); continue; }
        const hit = tabCache.get(key);
        if (hit !== undefined) out.set(key, hit);
        else {
            // Estimate: 7px padding and a 1px border a side, the glyph and the word (the letter).
            const text = (k: BranchTab): number => form === 'full' ? 3 + tabLabel(k).length * 5.6
                : form === 'short' && tabShort(k) ? 2 + tabShort(k).length * 6.2 : 0;
            out.set(key, kinds.reduce((w, k) => w + (form === 'full' ? 16 : 14) + 11 + text(k), 0) + 4 * (kinds.length - 1));
            todo.push({ key, kinds });
        }
    }
    if (todo.length === 0 || typeof document === 'undefined' || !document.body) return out;
    const host = hiddenHost();
    const els = todo.map(t => {
        const row = document.createElement('div');
        row.style.cssText = 'display:flex;align-items:center;gap:4px;width:max-content;height:18px;';
        row.className = tabsFormClass(form);
        row.innerHTML = t.kinds.map(k => `<button class="branch-tab ${tabKindClass(k)}" type="button">${branchTabRestHtml(k)}</button>`).join('');
        host.appendChild(row);
        return row;
    });
    document.body.appendChild(host);
    const cache = fontsReady();
    todo.forEach((t, i) => {
        const w = els[i].getBoundingClientRect().width;
        if (!w) return;
        out.set(t.key, w);
        if (cache) tabCache.set(t.key, w);
    });
    host.remove();
    return out;
}

/**
 * How a card's top-edge tabs show (TabsForm): with their words while the
 * row stays within the card's corner insets (`room`: the card's width less
 * both corner insets; one tab always keeps its word), else shortened to a
 * glyph and a letter each, and to the glyphs alone where even that would
 * reach into the tabs of the next card. The words stay for screen readers
 * and the bubbles name the relatives.
 */
export function tabsForm(kinds: readonly BranchTab[], room: number): TabsForm {
    if (kinds.length <= 1 || (measureTabRows([kinds]).get(rowKey(kinds)) ?? 0) <= room) return 'full';
    return (measureTabRows([kinds], 'short').get(rowKey(kinds, 'short')) ?? 0) <= room ? 'short' : 'glyph';
}
