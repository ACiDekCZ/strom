/**
 * The toasts and a bottom sheet over its darkened backdrop (a phone's or a
 * touch tablet's menu, the ⋯ of a Queue task, a section's menu).
 *
 * The sheet and its backdrop stand over everything on the page; a toast
 * stayed under them, half covered by the sheet's top edge and cut there.
 * The newer one wins, as with a card's bubble (round 7 §52,
 * src/bubble-layer.ts):
 * - a sheet opened over a toast on the screen hides that toast while it is
 *   open; its time runs on meanwhile, and when the sheet closes the toast
 *   comes back for what is left of it (or, its time over, it has gone);
 * - a toast coming while a sheet is open (an action of the sheet whose
 *   "Undo" must be at hand, a message from elsewhere) stands over the
 *   backdrop, its bottom edge 8 px over the sheet's top edge; beside a
 *   sheet at the side (a phone held sideways), in the room left of it;
 *   where the room above the sheet is too low for it, at the window's top.
 * Both go back to their places when the last sheet closes. A press on a
 * toast leaves the sheet open (pressOnToast).
 */

/** The bottom sheets with a darkened backdrop, put on the body while they are open. */
const SHEETS = 'body > .bottom-sheet-overlay, body > .live-sec-sheet-overlay';

/** The app's toasts: a message, the undo pill, the focus confirmation (its container, while it holds one). */
const TOASTS = 'body > .toast, body > .undo-toast, #focus-toast';

/** A toast hidden under a sheet opened over it. */
export const UNDER_SHEET = 'toast-under-sheet';
/** A toast standing over a sheet's backdrop, above the sheet. */
export const OVER_SHEET = 'toast-over-sheet';

/** The gap between a toast and the sheet's top edge, and the window's top edge. */
const GAP = 8;

let installed = false;
/** The sheet open now (the last one put on the body). */
let current: HTMLElement | null = null;
let hidden: HTMLElement[] = [];
/** The raised toasts, with the place each had of its own. */
const raised = new Map<HTMLElement, Own>();
let sizes: ResizeObserver | null = null;

/** The open sheet: the last one on the body. */
function openSheet(): HTMLElement | null {
    const all = document.querySelectorAll<HTMLElement>(SHEETS);
    return all.length > 0 ? all[all.length - 1] : null;
}

/** The toasts on the screen now (one waiting under another too: it may come back). */
function toastsShown(): HTMLElement[] {
    return [...document.querySelectorAll<HTMLElement>(TOASTS)].filter(t => t.id !== 'focus-toast' || t.querySelector(':scope > :not([hidden])') !== null);
}

/**
 * A press on a toast (its "Undo", its ×): the sheet or menu open under it
 * stays open, else the toast would glide back to its place under the finger.
 */
export function pressOnToast(target: EventTarget | null): boolean {
    return (target as Element | null)?.closest?.(TOASTS) != null;
}

/** The sheet's box in the window, where it stands once it has slid in (its glide left out). */
export interface SheetBox { left: number; top: number }

function sheetBox(overlay: HTMLElement): SheetBox {
    const box = overlay.firstElementChild as HTMLElement | null;
    const r = overlay.getBoundingClientRect();
    return box ? { left: r.left + box.offsetLeft, top: r.top + box.offsetTop } : { left: r.left, top: r.top };
}

/** Where a raised toast stands: its `bottom` (null: its own), its centre `left` and `maxWidth` (null: its own). */
export interface OverSheet { bottom: number | null; left: number | null; maxWidth: number | null }

/** The narrowest room beside a sheet a toast is put in. */
const SIDE_ROOM = 200;
/** A toast's gutters in the room beside a sheet. */
const SIDE_GUTTER = 16;

/**
 * Where a toast `height` tall stands over an open sheet in a window `vh`
 * tall: its bottom edge 8 px over the sheet's top edge; a sheet at the side
 * over the whole height (a phone held sideways), in the middle of the room
 * left of it, at its own height; too low a room above a sheet across the
 * window, at the window's top.
 */
export function placeOverSheet(sheet: SheetBox, height: number, vh: number): OverSheet {
    const edge = sheet.top - GAP;
    if (edge - height >= GAP) return { bottom: Math.max(0, vh - edge), left: null, maxWidth: null };
    if (sheet.left >= SIDE_ROOM) return { bottom: null, left: sheet.left / 2, maxWidth: sheet.left - 2 * SIDE_GUTTER };
    return { bottom: Math.max(0, vh - GAP - height), left: null, maxWidth: null };
}

/** The inline place a toast had of its own (a toast kept clear of a dialog's footer has its `bottom`). */
interface Own { bottom: string; left: string; maxWidth: string }

function lower(t: HTMLElement): void {
    const own = raised.get(t);
    if (!own) return;
    raised.delete(t);
    t.classList.remove(OVER_SHEET);
    t.style.bottom = own.bottom;
    t.style.left = own.left;
    t.style.maxWidth = own.maxWidth;
}

function setStyle(t: HTMLElement, prop: 'bottom' | 'left' | 'maxWidth', value: number | null, own: string): void {
    const v = value === null ? own : `${Math.round(value)}px`;
    if (t.style[prop] !== v) t.style[prop] = v;
}

/** The toasts that came while the sheet is open: over its backdrop, above it (or beside it). */
function raise(sheet: HTMLElement): void {
    const box = sheetBox(sheet);
    const vh = window.innerHeight;
    for (const t of toastsShown()) {
        if (hidden.includes(t)) continue;
        let own = raised.get(t);
        if (!own) {
            own = { bottom: t.style.bottom, left: t.style.left, maxWidth: t.style.maxWidth };
            raised.set(t, own);
            t.classList.add(OVER_SHEET);
        }
        const at = placeOverSheet(box, t.offsetHeight, vh);
        setStyle(t, 'left', at.left, own.left);
        setStyle(t, 'maxWidth', at.maxWidth, own.maxWidth);
        setStyle(t, 'bottom', at.bottom, own.bottom);
    }
    for (const t of [...raised.keys()]) if (!t.isConnected) raised.delete(t);
}

/** The sheet closed: the toasts hidden under it come back, the raised ones go back to their places. */
function restore(): void {
    for (const t of hidden) t.classList.remove(UNDER_SHEET);
    hidden = [];
    for (const t of [...raised.keys()]) lower(t);
    sizes?.disconnect();
}

/** Lay the toasts out for the sheet open now (none: back to their places). */
function update(): void {
    const sheet = openSheet();
    if (!sheet) {
        if (current) restore();
        current = null;
        return;
    }
    if (sheet !== current) {
        // A sheet opened over the toasts on the screen: they wait under it (another sheet replacing it keeps them)
        if (!current) {
            for (const t of toastsShown()) {
                if (raised.has(t)) continue;
                t.classList.add(UNDER_SHEET);
                hidden.push(t);
            }
        }
        current = sheet;
        sizes?.disconnect();
        const box = sheet.firstElementChild;
        if (sizes && box) sizes.observe(box);
    }
    raise(sheet);
}

/** Watch the sheets and the toasts (once; a sheet open already counts as open before any toast). */
export function watchSheets(): void {
    if (installed || typeof document === 'undefined' || typeof MutationObserver === 'undefined') return;
    installed = true;
    if (typeof ResizeObserver !== 'undefined') sizes = new ResizeObserver(() => { if (current) raise(current); });
    current = openSheet();
    const box = current?.firstElementChild;
    if (sizes && box) sizes.observe(box);
    const watch = new MutationObserver(() => update());
    watch.observe(document.body, { childList: true });
    // The focus confirmation's box comes and goes inside its container (which stays)
    const focus = document.getElementById('focus-toast');
    if (focus) watch.observe(focus, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden'] });
    window.addEventListener('resize', () => { if (current) raise(current); });
}
