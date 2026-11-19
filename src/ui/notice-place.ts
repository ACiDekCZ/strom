/**
 * Where the storage notices stand (src/ui/file-copy-ui.ts "changes only in
 * this browser tab", src/ui/encryption-ui.ts): CSS pins them under the top
 * bar. In the Table view the table's own controls are there (the row types,
 * Scope ▾, Columns, Export, the column headers): a notice there covered
 * Scope ▾ until it was closed (P1a, verification of 3.30.0). In the Table a
 * notice stands below the table's bar and head rows, over the rows; back
 * under the top bar in every other view. Measured, not by breakpoints: the
 * bar wraps by language and width, the chips row comes and goes.
 */

/** A notice of the body this module places (the storage notices). */
const NOTICES = 'body > .storage-notice';
/** The Table's controls a notice must leave free, top to bottom. */
const TABLE_TOP = ['#table-container > .tv-bar', '#table-container .tv-head'];
/** Gap under the table's head. */
const GAP = 8;

let installed = false;
let frame = 0;
let sizes: ResizeObserver | null = null;

function inTable(): boolean {
    return document.body.dataset.viewMode === 'table';
}

/** The lowest edge of the Table's bar and head rows (null: not the Table, or not drawn). */
export function tableControlsBottom(): number | null {
    if (!inTable()) return null;
    let bottom = -Infinity;
    for (const sel of TABLE_TOP) {
        const el = document.querySelector<HTMLElement>(sel);
        if (!el || getComputedStyle(el).display === 'none') continue;
        const r = el.getBoundingClientRect();
        if (r.height > 0) bottom = Math.max(bottom, r.bottom);
    }
    return bottom > -Infinity ? bottom : null;
}

/** Place every storage notice now: below the Table's controls, or where CSS puts it. */
export function placeStorageNotices(): void {
    frame = 0;
    const notices = [...document.querySelectorAll<HTMLElement>(NOTICES)];
    const below = notices.length ? tableControlsBottom() : null;
    for (const n of notices) n.style.top = below === null ? '' : `${Math.round(below + GAP)}px`;
    // The bar and the head change height (a wrap, the chips row, pinned rows): place again then.
    sizes?.disconnect();
    if (below === null || typeof ResizeObserver === 'undefined') return;
    sizes ??= new ResizeObserver(() => schedule());
    for (const sel of TABLE_TOP) {
        const el = document.querySelector<HTMLElement>(sel);
        if (el) sizes.observe(el);
    }
}

function schedule(): void {
    if (frame) return;
    frame = requestAnimationFrame(placeStorageNotices);
}

/**
 * A storage notice was added to the page: place it, and keep placing the
 * notices while any shows (a view change, a resize, the Table's bar wrapping).
 */
export function watchStorageNotices(): void {
    if (!installed) {
        installed = true;
        new MutationObserver(() => schedule()).observe(document.body, { attributes: true, attributeFilter: ['data-view-mode'] });
        window.addEventListener('resize', schedule);
    }
    placeStorageNotices();
}
