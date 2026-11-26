/**
 * A small surprise on About's "Buy me a coffee" button: each time the dialog
 * opens, one of nine short animations is chosen at random and plays once,
 * about two seconds later. Nothing plays with reduced motion, nor when the
 * dialog is closed before then. The decorations are aria-hidden, absolutely
 * placed (the layout never moves) and let clicks through; they are removed
 * when the animation ends, so the next opening can play again. At rest the
 * cup is the plain static icon.
 */

/** The nine variants (D was left out of the design on purpose). */
export const COFFEE_VARIANTS = ['A', 'B', 'C', 'E', 'F', 'G', 'H', 'I', 'J'] as const;
export type CoffeeVariant = typeof COFFEE_VARIANTS[number];

/** From opening the dialog to the animation. */
export const COFFEE_DELAY_MS = 2000;
/** The longest variant (B, about 3.45 s) and a margin: then the decorations go. */
export const COFFEE_RUN_MS = 3600;

/** One of the nine variants, evenly from `random()` in [0, 1). */
export function pickCoffeeVariant(random: () => number = () => Math.random()): CoffeeVariant {
    const n = COFFEE_VARIANTS.length;
    const i = Math.min(n - 1, Math.max(0, Math.floor(random() * n)));
    return COFFEE_VARIANTS[i];
}

/** Where the animation plays: the DOM in the app, a stand-in in tests. */
export interface CoffeeStage {
    reducedMotion(): boolean;
    /** The dialog is still open (it may close by any path, Escape included). */
    isOpen(): boolean;
    play(variant: CoffeeVariant): void;
    clear(): void;
}

export interface CoffeeScheduler {
    /** The dialog opened: the chosen variant, or null when nothing will play. */
    open(): CoffeeVariant | null;
    /** The dialog closed: nothing plays any more, the decorations go. */
    close(): void;
}

export function createCoffeeScheduler(stage: CoffeeStage, random: () => number = () => Math.random()): CoffeeScheduler {
    let wait: ReturnType<typeof setTimeout> | null = null;
    let run: ReturnType<typeof setTimeout> | null = null;

    const stop = (): void => {
        if (wait !== null) clearTimeout(wait);
        if (run !== null) clearTimeout(run);
        wait = run = null;
        stage.clear();
    };

    return {
        open(): CoffeeVariant | null {
            stop();
            if (stage.reducedMotion()) return null;
            const variant = pickCoffeeVariant(random);
            wait = setTimeout(() => {
                wait = null;
                if (!stage.isOpen() || stage.reducedMotion()) return;
                stage.play(variant);
                run = setTimeout(() => {
                    run = null;
                    stage.clear();
                }, COFFEE_RUN_MS);
            }, COFFEE_DELAY_MS);
            return variant;
        },
        close: stop,
    };
}

// ---- The decorations (SVG shapes from the approved design) ----

const HEART_PATH = '<path fill="currentColor" d="M12 21s-7.5-4.6-9.6-9.1C.9 8.6 3 5 6.5 5c2.1 0 3.6 1.2 4.5 2.6h2C13.9 6.2 15.4 5 17.5 5 21 5 23.1 8.6 21.6 11.9 19.5 16.4 12 21 12 21z"/>';

/** Every added element carries `acf-added`, so clearing finds them all. */
const fx = (cls: string, viewBox: string, inner: string): string =>
    `<svg class="acf-added acf-fx ${cls}" viewBox="${viewBox}" aria-hidden="true" focusable="false">${inner}</svg>`;
const heart = (cls: string): string => fx(cls, '0 0 24 24', HEART_PATH);

const LEAF = fx('acf-leaf', '0 0 24 24',
    '<path fill="currentColor" d="M20 3C10 3 4 8 4 15c0 2 .6 3.6 1.4 5L3 22.5 4.5 24 7 21.4C8.4 22.2 10 22.6 12 22.6 18 22.6 21 16 20 3z"/>'
    + '<path d="M7 19c3-4 6-7 10-11" stroke="var(--surface)" stroke-width="1.6" fill="none" stroke-linecap="round"/>');

const GUY = fx('acf-guy', '0 0 20 28',
    '<path class="acf-beat" fill="var(--heart)" d="M10 11s-4.2-2.6-5.3-5C3.9 4.2 5 2.2 7 2.2c1.2 0 2.1.7 2.6 1.5h.8c.5-.8 1.4-1.5 2.6-1.5 2 0 3.1 2 2.3 3.8C14.2 8.4 10 11 10 11z"/>'
    + '<path d="M10 21 5.5 13.5M10 21l4.5-7.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" fill="none"/>'
    + '<circle cx="10" cy="17" r="4" fill="currentColor"/>'
    + '<circle cx="8.6" cy="16.6" r=".65" fill="var(--surface)"/><circle cx="11.4" cy="16.6" r=".65" fill="var(--surface)"/>'
    + '<path d="M8.9 18.4q1.1.8 2.2 0" stroke="var(--surface)" stroke-width=".6" fill="none" stroke-linecap="round"/>'
    + '<path d="M10 21v6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>');

const DOG_HEAD = fx('acf-dog-peek', '0 0 24 24',
    '<path class="acf-ear acf-ear-l" d="M6.2 9.6 3 6.4c-.5-.5-.1-1.3.6-1.2l4.6.9z" fill="var(--tan)" stroke="var(--ink)" stroke-width=".7" stroke-linejoin="round"/>'
    + '<path class="acf-ear acf-ear-r" d="M17.8 9.6 21 6.4c.5-.5.1-1.3-.6-1.2l-4.6.9z" fill="var(--tan)" stroke="var(--ink)" stroke-width=".7" stroke-linejoin="round"/>'
    + '<ellipse cx="12" cy="13" rx="6.6" ry="6.1" fill="var(--dog)" stroke="var(--ink)" stroke-width=".8"/>'
    + '<path d="M6 11.2c.6-2.9 2.7-4.3 5-4.3v4.6c-1.4 1.4-3.4 1.2-5-.3z" fill="var(--tan)"/>'
    + '<path d="M18 11.2c-.6-2.9-2.7-4.3-5-4.3v3.2c1.3 1 3.4 1.6 5 1.1z" fill="var(--tan)"/>'
    + '<circle cx="9.3" cy="12.4" r="1" fill="var(--ink)"/><circle cx="14.7" cy="12.4" r="1" fill="var(--ink)"/>'
    + '<circle cx="9.6" cy="12.05" r=".3" fill="var(--dog-glint)"/><circle cx="15" cy="12.05" r=".3" fill="var(--dog-glint)"/>'
    + '<ellipse cx="12" cy="15" rx="1.3" ry=".95" fill="var(--ink)"/>'
    + '<path d="M10.6 16.6q1.4 1 2.8 0" stroke="var(--ink)" stroke-width=".6" fill="none" stroke-linecap="round"/>'
    + '<path class="acf-tongue" d="M11.4 16.9h1.2v1.2a.6.6 0 0 1-1.2 0z" fill="var(--dog-tongue)"/>');

const DOG_RUN = '<span class="acf-added acf-fx acf-dog-run" aria-hidden="true">'
    + '<svg class="acf-dog" viewBox="0 0 28 20" aria-hidden="true" focusable="false">'
    + '<path class="acf-tail" d="M6.6 9.2 3.4 4.6" stroke="var(--ink)" stroke-width="1.3" stroke-linecap="round"/>'
    + '<path d="M9 12.5 5.2 16.6M10.5 13 7.8 17.6M17.6 12.6l3.6 3.8M16.2 13.2l2.2 4.4" stroke="var(--ink)" stroke-width="1.2" stroke-linecap="round"/>'
    + '<ellipse cx="12.6" cy="10.6" rx="6.6" ry="3.7" fill="var(--dog)" stroke="var(--ink)" stroke-width=".8"/>'
    + '<path d="M9 7.6c1.6-.9 3.6-.9 5 .1-.6 1.4-2.8 1.8-5 .9z" fill="var(--tan)"/>'
    + '<ellipse cx="24.4" cy="8.4" rx="2.4" ry="1.5" fill="var(--dog)" stroke="var(--ink)" stroke-width=".7"/>'
    + '<circle cx="21" cy="6.8" r="3.6" fill="var(--dog)" stroke="var(--ink)" stroke-width=".8"/>'
    + '<path d="M19.4 3.6l-1.6-1.8 3.2.4z" fill="var(--tan)" stroke="var(--ink)" stroke-width=".6" stroke-linejoin="round"/>'
    + '<path d="M19.2 4.2c1.2-.6 2.4-.4 3.2.6-.7 1.1-2.3 1.3-3.4.6z" fill="var(--tan)"/>'
    + '<circle cx="22" cy="6.4" r=".7" fill="var(--ink)"/><circle cx="26.7" cy="8" r=".75" fill="var(--ink)"/>'
    + '</svg></span>';

const SPARKS = ['a', 'b', 'c', 'd'].map(k => `<span class="acf-added acf-fx acf-spark acf-spark-${k}" aria-hidden="true"></span>`).join('');

/** Inside the cup icon: a face that blinks (E) or smiles with closed eyes (F). */
const FACE_E = '<g class="acf-added acf-face" stroke="none">'
    + '<ellipse class="acf-eye" cx="8" cy="13.4" rx="1.05" ry="1.25"/><ellipse class="acf-eye" cx="12" cy="13.4" rx="1.05" ry="1.25"/>'
    + '<ellipse class="acf-blush" cx="6" cy="15.6" rx="1.2" ry=".7"/><ellipse class="acf-blush" cx="14" cy="15.6" rx="1.2" ry=".7"/>'
    + '<path d="M9 15.4q1 .9 2 0" stroke="currentColor" stroke-width=".9" fill="none"/></g>';
const FACE_F = '<g class="acf-added acf-face">'
    + '<path d="M6.9 13.9q1.1-1.4 2.2 0M10.9 13.9q1.1-1.4 2.2 0" stroke-width="1.1"/>'
    + '<ellipse class="acf-blush" cx="6" cy="15.8" rx="1.2" ry=".7" stroke="none"/><ellipse class="acf-blush" cx="14" cy="15.8" rx="1.2" ry=".7" stroke="none"/></g>';
/** H: a coffee bean in the cup, the cup's front (a filled lid) hiding its lower half. */
const BEAN = '<g class="acf-added acf-bean" stroke="none">'
    + '<ellipse cx="10" cy="7.2" rx="2.7" ry="3.4" fill="#6b4226" transform="rotate(-18 10 7.2)"/>'
    + '<path d="M9.2 4.4q1.6 2.8 .4 5.8" stroke="#3d2412" stroke-width=".7" fill="none"/>'
    + '<circle cx="9" cy="6.6" r=".42" fill="#fff"/><circle cx="11.1" cy="6.1" r=".42" fill="#fff"/></g>'
    + '<path class="acf-added acf-lid" d="M4 9h12v8a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4z"/>';

interface VariantParts {
    /** Behind the button, in the wrapper (C, I, J). */
    behind?: string;
    /** Over the button, in the link. */
    over?: string;
    /** Inside the cup icon, appended. */
    cupEnd?: string;
    /** Inside the cup icon, before its body (H). */
    cupBeforeBody?: string;
}

const PARTS: Record<CoffeeVariant, VariantParts> = {
    A: { over: heart('acf-heart-up') },
    B: { over: LEAF + heart('acf-heart-up') },
    C: { behind: GUY },
    E: { cupEnd: FACE_E, over: heart('acf-mini acf-m1') },
    F: { cupEnd: FACE_F, over: heart('acf-mini acf-m1') + heart('acf-mini acf-m2') },
    G: { over: heart('acf-mini acf-m1') + SPARKS },
    H: { cupBeforeBody: BEAN },
    I: { behind: DOG_HEAD, over: heart('acf-mini acf-m1') },
    // The terrier runs behind the button (seen beside it), never over the paragraph above.
    J: { behind: DOG_RUN, over: heart('acf-mini acf-m1') },
};

const SVG_NS = 'http://www.w3.org/2000/svg';

/** SVG children parsed in the SVG namespace (a template svg's innerHTML). */
function svgChildren(markup: string): Element[] {
    const tmp = document.createElementNS(SVG_NS, 'svg');
    tmp.innerHTML = markup;
    return [...tmp.children];
}

/** The DOM stage: the wrapper around the coffee link inside the About dialog. */
export function domCoffeeStage(wrap: HTMLElement, dialog: HTMLElement): CoffeeStage {
    return {
        reducedMotion: () => !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches,
        isOpen: () => dialog.classList.contains('active') && wrap.isConnected,
        play(variant) {
            const link = wrap.querySelector<HTMLElement>('.about-coffee');
            const cup = link?.querySelector<SVGSVGElement>('.about-coffee-cup');
            if (!link || !cup) return;
            const parts = PARTS[variant];
            if (parts.behind) link.insertAdjacentHTML('beforebegin', parts.behind);
            if (parts.over) link.insertAdjacentHTML('beforeend', parts.over);
            if (parts.cupEnd) cup.append(...svgChildren(parts.cupEnd));
            if (parts.cupBeforeBody) {
                const body = cup.lastElementChild;
                for (const el of svgChildren(parts.cupBeforeBody)) cup.insertBefore(el, body);
            }
            wrap.dataset.acf = variant;
        },
        clear() {
            delete wrap.dataset.acf;
            wrap.querySelectorAll('.acf-added').forEach(el => el.remove());
        },
    };
}

let scheduler: CoffeeScheduler | null = null;

/** About opened: choose a variant and play it a little later. */
export function startAboutCoffee(): void {
    const dialog = document.getElementById('about-modal');
    const wrap = dialog?.querySelector<HTMLElement>('.about-coffee-wrap');
    if (!dialog || !wrap) return;
    scheduler ??= createCoffeeScheduler(domCoffeeStage(wrap, dialog));
    scheduler.open();
}

/** About closed: nothing plays, the decorations go. */
export function stopAboutCoffee(): void {
    scheduler?.close();
}
