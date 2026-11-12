/**
 * The tree legend and back / forward on a phone (spec 082 K1.2, T44): the
 * legend stands at the bottom edge, the round buttons above it. Their place
 * depends on the legend's height (a pill, or a panel with the card marks), so
 * the body carries it as `--tree-legend-h` and, while the legend shows,
 * the class `tree-legend-shown` (the CSS in index.html lifts the buttons).
 */

let observer: ResizeObserver | null = null;
let observed: HTMLElement | null = null;

function writeHeight(el: HTMLElement): void {
    const h = el.style.display === 'none' ? 0 : Math.ceil(el.getBoundingClientRect().height);
    document.body.style.setProperty('--tree-legend-h', `${h}px`);
}

/** Mark whether the legend shows and keep its height on the body. */
export function syncTreeLegendLift(el: HTMLElement, shown: boolean): void {
    document.body.classList.toggle('tree-legend-shown', shown);
    if (observed !== el && typeof ResizeObserver !== 'undefined') {
        observer?.disconnect();
        observer = new ResizeObserver(() => writeHeight(el));
        observer.observe(el);
        observed = el;
    }
    writeHeight(el);
}
