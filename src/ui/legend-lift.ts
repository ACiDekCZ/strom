/**
 * The legend and back / forward in the bottom-left corner (spec 082 K1.2,
 * T44; every width since T54 H1): the legend keeps its place, the round
 * buttons stand above it while they show. Their place depends on the
 * legend's height (a pill, a chip, a panel with the card marks, the fan's
 * card open or folded), so the body carries it as `--tree-legend-h` (the
 * tree's legend) or `--fan-legend-h` (the fan's) and, while that legend
 * shows, the class `tree-legend-shown` or `fan-legend-shown` (the CSS in
 * index.html lifts the buttons).
 */

interface Lift {
    observer: ResizeObserver | null;
    observed: HTMLElement | null;
}

const lifts: Record<'tree' | 'fan', Lift> = {
    tree: { observer: null, observed: null },
    fan: { observer: null, observed: null },
};

function writeHeight(kind: 'tree' | 'fan', el: HTMLElement): void {
    // The exact height, fractions kept: rounded up, a legend of a fractional height
    // (rows of the lineage signs) would lift the buttons 1px past their 8px gap.
    const h = el.style.display === 'none' || el.hidden ? 0 : Math.round(el.getBoundingClientRect().height * 100) / 100;
    document.body.style.setProperty(`--${kind}-legend-h`, `${h}px`);
    // The fan's card is hidden by its view (and on a phone, which has the chip): shown means it has a size.
    if (kind === 'fan') document.body.classList.toggle('fan-legend-shown', h > 0);
}

function observe(kind: 'tree' | 'fan', el: HTMLElement): void {
    const lift = lifts[kind];
    if (lift.observed !== el && typeof ResizeObserver !== 'undefined') {
        lift.observer?.disconnect();
        lift.observer = new ResizeObserver(() => writeHeight(kind, el));
        lift.observer.observe(el);
        lift.observed = el;
    }
    writeHeight(kind, el);
}

/** Mark whether the tree's legend shows and keep its height on the body. */
export function syncTreeLegendLift(el: HTMLElement, shown: boolean): void {
    document.body.classList.toggle('tree-legend-shown', shown);
    observe('tree', el);
}

/** Keep the fan's legend card's height on the body (0 while it is not drawn). */
export function syncFanLegendLift(el: HTMLElement): void {
    observe('fan', el);
}
