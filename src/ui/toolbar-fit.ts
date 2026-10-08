/**
 * Desktop toolbar fit: "＋ Add person" folds to ＋ alone when the toolbar
 * cannot hold every control with its full label.
 *
 * Fixed widths cannot know the content: a tree tied to a research adds the
 * Research button and the research state beside the logo, and the labels
 * differ by language (de is the widest). So the fit is measured instead. The
 * toolbar overflows (its last button is cut at the window edge) or the tree
 * switcher is squeezed below its own pill, which then slides under the search
 * field: in either case `.toolbar-add-compact` hides the label of the add
 * button (its tooltip and accessible name stay).
 *
 * The measurement is always taken with the full label, so the decision is a
 * function of the width and the content alone and cannot oscillate. Leaving
 * the compact state asks for HYSTERESIS_PX of spare room, so a window resized
 * across the boundary does not flip the label pixel by pixel.
 *
 * The fixed 1180–1280 px rule in index.html (a research tree, ＋ alone) stays:
 * measured on top of it, the toolbar fits and this class is not set there.
 */

import { isDesktop } from '../breakpoints.js';

const COMPACT_CLASS = 'toolbar-add-compact';
const HYSTERESIS_PX = 16;

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
        }
    }
    toolbar.style.paddingRight = previous;
    return tight;
}

/** Re-measure the toolbar and set or clear the compact add button. */
export function updateToolbarFit(): void {
    const toolbar = document.querySelector<HTMLElement>('.toolbar');
    if (!toolbar) return;
    if (!isDesktop()) {
        toolbar.classList.remove(COMPACT_CLASS);
        return;
    }
    const wasCompact = toolbar.classList.contains(COMPACT_CLASS);
    toolbar.classList.remove(COMPACT_CLASS);
    const compact = tooTight(toolbar, wasCompact ? HYSTERESIS_PX : 0);
    toolbar.classList.toggle(COMPACT_CLASS, compact);
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
    updateToolbarFit();
}
