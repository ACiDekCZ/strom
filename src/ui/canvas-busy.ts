/**
 * A computation over the whole canvas (waiting buttons §8, screen 8a): the tree laid out anew ("Show in the
 * tree", "Next person ›", a choice that redraws the tree), the map's places over the whole tree.
 *
 * The overlay `.canvas-busy` goes over the view's area before the work starts and is painted first
 * (`nextPaint`), the work runs after it. It is seen only past 120 ms: a quick layout never blinks. A layout
 * computed in one go holds the page meanwhile, so no timer of the page can show it then; the stylesheet does
 * (an opacity animation delayed by 120 ms, run by the compositor while the page computes). A work that yields
 * (a render reading the other trees first) shows it by the timer as well. Once seen it stays at least 300 ms.
 * The cards under it are dimmed as one area (.45), the words in the middle, the 16 px spinner.
 */

import { strings } from '../strings.js';
import { BUSY_MIN_MS, BUSY_SHOW_MS, nextPaint, spinEl } from './busy.js';

export const CANVAS_BUSY_CLASS = 'canvas-busy';

interface Overlay {
    area: HTMLElement;
    el: HTMLElement;
    text: HTMLElement;
    /** Works running under it (a second one started meanwhile shares it). */
    depth: number;
    /** When it went on the screen (painted), for the 120 ms and the 300 ms. */
    start: number;
    shownTimer: ReturnType<typeof setTimeout> | null;
    holdTimer: ReturnType<typeof setTimeout> | null;
}

let current: Overlay | null = null;
/**
 * How long the last work under the overlay took: past 120 ms the next one (the same tree, as large) shows the
 * overlay at once, as a computation sure to be long does (§1.1 `heavy: 'now'`), and does not count on the
 * delayed animation alone.
 */
let lastWorkMs = 0;

/** The area the overlay covers: the views' container (tree, map, fan, timeline, table). */
function defaultArea(): HTMLElement | null {
    return document.getElementById('tree-container');
}

function shown(o: Overlay): void {
    o.el.dataset.shown = 'true';
}

function remove(o: Overlay): void {
    if (o.shownTimer) clearTimeout(o.shownTimer);
    if (o.holdTimer) clearTimeout(o.holdTimer);
    o.el.remove();
    o.area.removeAttribute('aria-busy');
    if (current === o) current = null;
}

function create(area: HTMLElement, label: string): Overlay {
    const el = document.createElement('div');
    el.className = CANVAS_BUSY_CLASS;
    const ovl = document.createElement('div');
    ovl.className = 'ovl';
    ovl.setAttribute('role', 'status');
    const text = document.createElement('span');
    text.textContent = label;
    ovl.append(spinEl(16), text);
    el.appendChild(ovl);
    area.appendChild(el);
    area.setAttribute('aria-busy', 'true');
    return { area, el, text, depth: 0, start: 0, shownTimer: null, holdTimer: null };
}

/** Whether the overlay is up (working or holding its 300 ms). */
export function canvasBusyActive(): boolean {
    return !!current;
}

/**
 * Run `work` (the layout, kept sync or async as it is) under the canvas overlay with `label`
 * ("Calculating the layout…" by default). The overlay is painted before `work` runs; with `stateFirst` the
 * work runs at once (its state changes now, as a choice must) and awaits its `ready` before the layout. Resolves with the work's result as soon as it ends; the overlay
 * stays its 300 ms when it was seen. A work started while another runs shares its overlay.
 */
export async function canvasBusy<T>(
    work: (ready: () => Promise<void>) => T | Promise<T>,
    opts: { label?: string; area?: HTMLElement | null; stateFirst?: boolean } = {},
): Promise<T> {
    const label = opts.label ?? strings.busy.layout;
    let o = current;
    if (o && o.area.isConnected) {
        // Another layout while one runs or holds: the same overlay, its words for this one.
        if (o.holdTimer) { clearTimeout(o.holdTimer); o.holdTimer = null; }
        delete o.el.dataset.hold;
        o.text.textContent = label;
    } else {
        if (o) remove(o);
        const area = opts.area === undefined ? defaultArea() : opts.area;
        if (!area) return work(() => Promise.resolve());
        o = create(area, label);
        if (lastWorkMs >= BUSY_SHOW_MS) shown(o);
        current = o;
    }
    const mine = o;
    mine.depth++;
    let painted = false;
    const ready = async (): Promise<void> => {
        if (painted) return;
        painted = true;
        if (mine.start) return;
        // Painted before the layout: the delayed animation then runs on its own while the page computes.
        await nextPaint();
        if (mine.start) return;
        mine.start = Date.now();
        mine.shownTimer = setTimeout(() => shown(mine), BUSY_SHOW_MS);
    };
    // `stateFirst`: the work changes its state at once and calls `ready` before its layout.
    if (!opts.stateFirst) await ready();
    try {
        return await work(ready);
    } finally {
        mine.depth--;
        if (mine.depth === 0) end(mine);
    }
}

/** The work is done: away at once when never seen, else after its 300 ms. */
function end(o: Overlay): void {
    if (o.shownTimer) { clearTimeout(o.shownTimer); o.shownTimer = null; }
    // A work with its state first that needed no layout: the overlay was never painted.
    if (!o.start) { remove(o); return; }
    const elapsed = Date.now() - o.start;
    lastWorkMs = elapsed;
    if (elapsed < BUSY_SHOW_MS && !o.el.dataset.shown) { remove(o); return; }
    // Seen (by the stylesheet while the page computed, or by the timer): it stays seen until its minimum.
    shown(o);
    o.el.dataset.hold = 'true';
    const wait = (elapsed < BUSY_SHOW_MS ? BUSY_MIN_MS : BUSY_SHOW_MS + BUSY_MIN_MS) - elapsed;
    if (wait <= 0) { remove(o); return; }
    o.holdTimer = setTimeout(() => remove(o), wait);
}

/** For the tests: the overlay gone at once. */
export function resetCanvasBusy(): void {
    if (current) remove(current);
    lastWorkMs = 0;
}
