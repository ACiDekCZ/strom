/**
 * Desktop toolbar fit: "＋ Add person" folds to ＋ alone when the toolbar
 * cannot hold every control with its full label.
 *
 * Fixed widths cannot know the content: a tree tied to a research adds the
 * Research button and the research state beside the logo, and the labels
 * differ by language (de is the widest). So the fit is measured instead. The
 * toolbar overflows (its last button is cut at the window edge), the tree
 * switcher is squeezed below its own pill, which then slides under the search
 * field, or the pill keeps its place but its tree name is cut shorter than the
 * name's own cap (de at 1440 with a research: "F."): in each case
 * `.toolbar-add-compact` hides the label of the add button (its tooltip and
 * accessible name stay). A renamed tree is measured again (the name's text is
 * watched: a name squeezed before and after need not change any size).
 *
 * The measurement is always taken with the full label, so the decision is a
 * function of the width and the content alone and cannot oscillate. Leaving
 * the compact state asks for HYSTERESIS_PX of spare room, so a window resized
 * across the boundary does not flip the label pixel by pixel.
 *
 * The fixed 1180–1280 px rule in index.html (a research tree, ＋ alone) stays:
 * measured on top of it, the toolbar fits and this class is not set there.
 *
 * A research tree also keeps the search field usable: the Research button and
 * the source images badge take their room from the search field, so its input
 * must still hold its placeholder (up to SEARCH_ROOM_CAP_PX). When it does not,
 * the add button folds first; when that is still not enough,
 * `.toolbar-squeeze` shortens the images badge to its icon and count and folds
 * the "Actions" label into ⋯. A tree without a research is measured as before.
 */

import { isDesktop } from '../breakpoints.js';

const COMPACT_CLASS = 'toolbar-add-compact';
const SQUEEZE_CLASS = 'toolbar-squeeze';
const HYSTERESIS_PX = 16;
/** The search input never asks for more room than this (a long placeholder may be cut). */
export const SEARCH_ROOM_CAP_PX = 120;

let measureCtx: CanvasRenderingContext2D | null | undefined;
const placeholderWidths = new Map<string, number>();

/** The width the search input's placeholder needs, in its own font. */
function placeholderWidth(input: HTMLInputElement, cs: CSSStyleDeclaration): number {
    const font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    const key = `${font}|${input.placeholder}`;
    const known = placeholderWidths.get(key);
    if (known !== undefined) return known;
    if (measureCtx === undefined) measureCtx = document.createElement('canvas').getContext('2d');
    if (!measureCtx) return 0;
    measureCtx.font = font;
    const width = measureCtx.measureText(input.placeholder).width;
    placeholderWidths.set(key, width);
    return width;
}

/**
 * The room the search input lacks for its placeholder (0 when it fits), with
 * `reserve` px held back. Only a research tree is measured this way.
 */
export function searchShortfall(toolbar: HTMLElement, reserve = 0): number {
    if (!document.body.classList.contains('research-actions')) return 0;
    const input = toolbar.querySelector<HTMLInputElement>('#toolbar-search-picker .person-picker-input');
    if (!input || !input.placeholder || input.getClientRects().length === 0) return 0;
    const cs = getComputedStyle(input);
    const room = input.clientWidth - (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0) - reserve;
    const need = Math.min(placeholderWidth(input, cs), SEARCH_ROOM_CAP_PX);
    return Math.max(0, Math.ceil(need - room));
}

/** True when the toolbar, as laid out now, does not hold its content. */
function tooTight(toolbar: HTMLElement, reserve: number): boolean {
    const previous = toolbar.style.paddingRight;
    if (reserve > 0) {
        const pad = parseFloat(getComputedStyle(toolbar).paddingRight) || 0;
        toolbar.style.paddingRight = `${pad + reserve}px`;
    }
    let tight = toolbar.scrollWidth > toolbar.clientWidth + 0.5;
    if (!tight) {
        const switcher = toolbar.querySelector<HTMLElement>('.tree-switcher');
        const pill = switcher?.querySelector<HTMLElement>('.tree-switcher-btn');
        if (switcher && pill && pill.getClientRects().length > 0) {
            tight = pill.getBoundingClientRect().right > switcher.getBoundingClientRect().right + 0.5;
            const name = pill.querySelector<HTMLElement>('.tree-name');
            if (!tight && name) {
                // Cut by the squeeze, not by its own max-width: shorter than both its text and its cap.
                const cap = parseFloat(getComputedStyle(name).maxWidth);
                const wanted = Number.isFinite(cap) ? Math.min(name.scrollWidth, cap) : name.scrollWidth;
                tight = name.getBoundingClientRect().width + 1 < wanted;
            }
        }
    }
    toolbar.style.paddingRight = previous;
    return tight || searchShortfall(toolbar, reserve) > 0;
}

/** Re-measure the toolbar and set or clear the compact add button (and the squeeze). */
export function updateToolbarFit(): void {
    const toolbar = document.querySelector<HTMLElement>('.toolbar');
    if (!toolbar) return;
    if (!isDesktop()) {
        toolbar.classList.remove(COMPACT_CLASS, SQUEEZE_CLASS);
        return;
    }
    const wasCompact = toolbar.classList.contains(COMPACT_CLASS);
    const wasSqueezed = toolbar.classList.contains(SQUEEZE_CLASS);
    toolbar.classList.remove(COMPACT_CLASS, SQUEEZE_CLASS);
    const compact = tooTight(toolbar, wasCompact ? HYSTERESIS_PX : 0);
    toolbar.classList.toggle(COMPACT_CLASS, compact);
    // The second step, measured with ＋ alone: only the search field's room decides it.
    const squeeze = compact && searchShortfall(toolbar, wasSqueezed ? HYSTERESIS_PX : 0) > 0;
    toolbar.classList.toggle(SQUEEZE_CLASS, squeeze);
}

/**
 * Watch the toolbar and its controls: a window resize, a language switch, the
 * Research button appearing or a label changing all change a size. The
 * measurement runs in the next frame, never inside the observer callback, so
 * the class toggle cannot feed a resize-observer loop.
 */
export function initToolbarFit(): void {
    const toolbar = document.querySelector<HTMLElement>('.toolbar');
    if (!toolbar || typeof ResizeObserver === 'undefined') return;
    let scheduled = false;
    const schedule = (): void => {
        if (scheduled) return;
        scheduled = true;
        requestAnimationFrame(() => {
            scheduled = false;
            updateToolbarFit();
        });
    };
    const observer = new ResizeObserver(schedule);
    const observeAll = (): void => {
        observer.observe(toolbar);
        for (const child of Array.from(toolbar.children)) observer.observe(child);
    };
    observeAll();
    new MutationObserver(() => { observeAll(); schedule(); }).observe(toolbar, { childList: true });
    const treeName = document.getElementById('current-tree-name');
    if (treeName) new MutationObserver(schedule).observe(treeName, { childList: true, characterData: true, subtree: true });
    updateToolbarFit();
}
