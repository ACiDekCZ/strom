/**
 * The marriage-order pill and the card's hidden-relatives tabs measured in the
 * browser (T13): hidden copies with the screen's own classes, so the layout of
 * the pill and the tabs (placeUnionOrderPill) and the image export's pill use
 * the widths the screen draws. Cached once the pill font is in; measured
 * before that, the values are used but not kept (pillFontsPending says when to
 * measure again).
 */

import { PillMetrics, HiddenRelativesTab, estimatePillMetrics } from './marriage-order.js';
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

/** The visible inside of a pill: its number, the ∞ and the year (the screen's markup). */
export function unionOrderPillPartsHtml(ordinal: string, year: string): string {
    return `<span class="uo-num">${escapeHtml(ordinal)}</span>`
        + `<span class="pill-glyph uo-glyph">∞</span>`
        + (year ? `<span class="uo-year">${escapeHtml(year)}</span>` : '');
}

const TAB_GLYPH: Record<HiddenRelativesTab, string> = { parents: '◂', siblings: '◆', children: '▸' };

function tabLabel(kind: HiddenRelativesTab): string {
    return kind === 'parents' ? strings.focus.branchTabParents
        : kind === 'siblings' ? strings.focus.branchTabSiblings : strings.focus.branchTabChildren;
}

/** The resting look of a hidden-relatives tab (no bubble): its glyph and word. */
export function branchTabRestHtml(kind: HiddenRelativesTab): string {
    return `<span class="pill-glyph">${TAB_GLYPH[kind]}</span><span class="pill-text">${escapeHtml(tabLabel(kind))}</span>`;
}

function hiddenHost(): HTMLElement {
    const host = document.createElement('div');
    host.setAttribute('aria-hidden', 'true');
    host.style.cssText = 'position:absolute;left:-100000px;top:0;visibility:hidden;pointer-events:none;contain:layout style;';
    return host;
}

const pillKey = (ordinal: string, year: string): string => `${ordinal}\u0000${year}`;

/**
 * Pills measured in the screen's markup and styles: their widths and where
 * their parts sit. One hidden batch for the ones not cached yet; without a
 * document, the estimate.
 */
export function measureUnionOrderPills(items: Iterable<{ ordinal: string; year: string }>): Map<string, PillMetrics> {
    const out = new Map<string, PillMetrics>();
    const todo: Array<{ ordinal: string; year: string; key: string }> = [];
    for (const { ordinal, year } of items) {
        const key = pillKey(ordinal, year);
        if (out.has(key)) continue;
        const hit = pillCache.get(key);
        if (hit) out.set(key, hit);
        else { out.set(key, estimatePillMetrics(ordinal, year)); todo.push({ ordinal, year, key }); }
    }
    if (todo.length === 0 || typeof document === 'undefined' || !document.body) return out;
    const host = hiddenHost();
    const els = todo.map(t => {
        const wrap = document.createElement('div');
        wrap.style.cssText = 'display:block;width:max-content;';
        wrap.innerHTML = `<span class="union-order-pill">${unionOrderPillPartsHtml(t.ordinal, t.year)}</span>`;
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
        if (!r.width || !num || !glyph) return;   // not laid out (no styles): keep the estimate
        const m: PillMetrics = {
            width: r.width,
            numX: num.left - r.left,
            glyphX: glyph.left - r.left + glyph.width / 2,
            yearX: year ? year.left - r.left : 0,
        };
        out.set(t.key, m);
        if (cache) pillCache.set(t.key, m);
    });
    host.remove();
    return out;
}

/** One pill measured (see measureUnionOrderPills). */
export function measureUnionOrderPill(ordinal: string, year: string): PillMetrics {
    return measureUnionOrderPills([{ ordinal, year }]).get(pillKey(ordinal, year))!;
}

/** The key of a pill in measureUnionOrderPills' result. */
export { pillKey as unionOrderPillKey };

/** The key of a row of tabs in measureTabRows' result (its words: the language's). */
export function rowKey(kinds: readonly HiddenRelativesTab[]): string {
    return kinds.map(k => `${k}:${tabLabel(k)}`).join(',');
}

/**
 * Widths of rows of resting hidden-relatives tabs (4px apart, as on the card's
 * top edge), one per distinct row; 0 for an empty row.
 */
export function measureTabRows(rows: Iterable<readonly HiddenRelativesTab[]>): Map<string, number> {
    const out = new Map<string, number>();
    const todo: Array<{ key: string; kinds: readonly HiddenRelativesTab[] }> = [];
    for (const kinds of rows) {
        const key = rowKey(kinds);
        if (out.has(key)) continue;
        if (kinds.length === 0) { out.set(key, 0); continue; }
        const hit = tabCache.get(key);
        if (hit !== undefined) out.set(key, hit);
        else {
            // Estimate: 7px padding and a 1px border a side, the glyph and the word.
            out.set(key, kinds.reduce((w, k) => w + 16 + 11 + 3 + tabLabel(k).length * 5.6, 0) + 4 * (kinds.length - 1));
            todo.push({ key, kinds });
        }
    }
    if (todo.length === 0 || typeof document === 'undefined' || !document.body) return out;
    const host = hiddenHost();
    const els = todo.map(t => {
        const row = document.createElement('div');
        row.style.cssText = 'display:flex;align-items:center;gap:4px;width:max-content;height:18px;';
        row.innerHTML = t.kinds.map(k => `<button class="branch-tab" type="button">${branchTabRestHtml(k)}</button>`).join('');
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
