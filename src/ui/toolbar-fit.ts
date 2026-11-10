/**
 * Desktop toolbar fit: the toolbar gives way step by step when it cannot hold
 * every control with its full label.
 *
 * Fixed widths cannot know the content: a tree tied to a research adds the
 * Research button and the research state beside the logo, and the labels
 * differ by language (de is the widest). So the fit is measured instead. The
 * toolbar is too tight when it overflows (its last button is cut at the
 * window edge), the tree switcher is squeezed below its own pill (which then
 * slides under the search field), the pill keeps its place but its tree name
 * is cut shorter than the name's own cap (de at 1440 with a research: "F."),
 * or a research tree's search field cannot hold its placeholder (up to
 * SEARCH_ROOM_CAP_PX). The steps (spec 073 §1.2), each taken only when the
 * ones before it are not enough:
 *
 *   1. `.toolbar-add-compact`: "＋ Add person" → ＋ alone (its tooltip and
 *      accessible name stay);
 *   2. `.toolbar-squeeze`: narrower view tabs, no "/" hint;
 *   3. `.toolbar-squeeze-2`: "Actions ▾" → ⋯;
 *   4. `.toolbar-squeeze-name`: the tree's name capped shorter ("…", the
 *      whole name in its tooltip);
 *   5. `.toolbar-squeeze-3`: the search field → the magnifier, the field
 *      opens over the toolbar.
 *
 * The view tabs never fold. A renamed tree is measured again (the name's text
 * is watched: a name squeezed before and after need not change any size).
 *
 * Each step is measured with the steps before it taken and itself not, so the
 * decision is a function of the width and the content alone and cannot
 * oscillate. Leaving a step asks for HYSTERESIS_PX of spare room, so a window
 * resized across a boundary does not flip it pixel by pixel.
 *
 * The fixed 1180–1280 px rule in index.html (a research tree, ＋ alone) stays:
 * measured on top of it, the toolbar fits and the first class is not needed there.
 */

import { isDesktop } from '../breakpoints.js';

/** The steps in their order (see above). */
export const TOOLBAR_FIT_STEPS = ['toolbar-add-compact', 'toolbar-squeeze', 'toolbar-squeeze-2', 'toolbar-squeeze-name', 'toolbar-squeeze-3'] as const;
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

/** Re-measure the toolbar and take as many steps as it needs. */
export function updateToolbarFit(): void {
    const toolbar = document.querySelector<HTMLElement>('.toolbar');
    if (!toolbar) return;
    if (!isDesktop()) {
        toolbar.classList.remove(...TOOLBAR_FIT_STEPS);
        nameTooltip(toolbar);
        return;
    }
    const had = TOOLBAR_FIT_STEPS.map(step => toolbar.classList.contains(step));
    toolbar.classList.remove(...TOOLBAR_FIT_STEPS);
    for (let i = 0; i < TOOLBAR_FIT_STEPS.length; i++) {
        if (!tooTight(toolbar, had[i] ? HYSTERESIS_PX : 0)) break;
        toolbar.classList.add(TOOLBAR_FIT_STEPS[i]);
    }
    nameTooltip(toolbar);
}

/** A tree name cut short carries the whole name in its tooltip. */
function nameTooltip(toolbar: HTMLElement): void {
    const name = toolbar.querySelector<HTMLElement>('#current-tree-name');
    if (!name) return;
    const cut = name.scrollWidth > name.clientWidth + 1;
    if (cut) name.title = name.textContent ?? '';
    else name.removeAttribute('title');
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
