/**
 * Loading the map's background tiles within the OpenStreetMap tile policy.
 *
 * - From a page served over http(s) a tile is a plain <img> with an explicit
 *   Referrer-Policy, so the Referer the policy asks of web pages is sent even
 *   if the hosting page set a stricter one.
 * - The first tile of a page's life is also read once with fetch(): the OSM
 *   servers answer a blocked request with HTTP 200 and an "Access blocked"
 *   picture, which an <img> cannot tell from a tile. A refusal switches every
 *   tile to the 'tagged' way (fetch with an X-Requested-With app id, see
 *   TileAccess in map.ts) and the tiles already drawn are loaded again.
 * - A page with no Referer at all (opened as a file) starts 'tagged'.
 * - A refusal of a tagged request ends tile loading for the page's life: no
 *   repeated asking, the map says so once and its points stay.
 *
 * Nothing is fetched ahead: only the tiles of the current view are asked for,
 * a tile that leaves the view before it arrives is aborted, and the browser's
 * HTTP cache serves repeated views (no cache-busting headers are ever sent).
 *
 * A tile waits 15 s at most (§10.3). One that did not come (the network, the
 * server's request limit or overload, no answer in time) is marked failed: the
 * map says so once in its corner with Try again (`retryMapTiles`), and the
 * sentence goes as soon as no failed tile is left in its view (a late tile, a
 * retry, the tile panned away). A request limit is not a refusal: Try again
 * asks again later.
 */

import { initialTileAccess, isBlockedTileResponse, TILE_REQUESTED_WITH, type TileAccess } from '../map.js';
import { strings } from '../strings.js';

let access: TileAccess | null = null;
let probed = false;
let blocked = false;
const listeners = new Set<() => void>();
const pending = new WeakMap<HTMLImageElement, AbortController>();
const timers = new WeakMap<HTMLImageElement, ReturnType<typeof setTimeout>>();
const watched = new WeakSet<HTMLImageElement>();

/** A tile waits this long at most before it counts as not loaded (§10.3). */
export const TILE_TIMEOUT_MS = 15_000;

/** The class every tile image carries (the main map and the small maps). */
const TILE_SELECTOR = 'img.map-tile';

function currentAccess(): TileAccess {
    if (access === null) access = initialTileAccess(location.protocol);
    return access;
}

/** The tile server refused even the tagged requests: no background for this page's life. */
export function mapTilesBlocked(): boolean {
    return blocked;
}

/**
 * Called after the way tiles are loaded changed, they were refused, or a tile
 * failed or came after all (the corner sentence). Returns the unsubscribe.
 */
export function onMapTilesChange(fn: () => void): () => void {
    listeners.add(fn);
    return () => listeners.delete(fn);
}

function tell(): void {
    for (const fn of listeners) fn();
}

/** Many tiles fail together (offline): the maps are told once. */
let telling = false;
function tellSoon(): void {
    if (telling) return;
    telling = true;
    queueMicrotask(() => { telling = false; tell(); });
}

function changed(): void {
    // Tiles drawn the old way are loaded again (or emptied when refused).
    for (const img of Array.from(document.querySelectorAll<HTMLImageElement>(TILE_SELECTOR))) {
        const url = img.dataset.tileUrl;
        if (url && img.dataset.tileAccess !== (blocked ? 'blocked' : currentAccess())) loadMapTile(img, url);
    }
    tell();
}

/** The tile came, or will not be asked for: no limit runs, and a failure it had is gone. */
function settled(img: HTMLImageElement, state: 'loaded' | null): void {
    const t = timers.get(img);
    if (t !== undefined) { clearTimeout(t); timers.delete(img); }
    const was = img.dataset.tileState;
    if (state) img.dataset.tileState = state;
    else delete img.dataset.tileState;
    if (was === 'failed') tellSoon();
}

/** The tile did not come (the network, a request limit, no answer in 15 s). */
function failed(img: HTMLImageElement): void {
    const t = timers.get(img);
    if (t !== undefined) { clearTimeout(t); timers.delete(img); }
    if (img.dataset.tileState === 'failed') return;
    img.dataset.tileState = 'failed';
    tellSoon();
}

/** The image itself tells whether it came: listened to once per image. */
function watch(img: HTMLImageElement): void {
    if (watched.has(img)) return;
    watched.add(img);
    img.addEventListener('load', () => { if (img.getAttribute('src')) settled(img, 'loaded'); });
    img.addEventListener('error', () => { if (img.getAttribute('src') && img.dataset.tileAccess !== 'blocked') failed(img); });
}

/** The server asks for fewer requests or is overloaded: not a refusal, the tile may come later. */
function overloaded(status: number): boolean {
    return status === 429 || status >= 500;
}

/** A tile asked for that did not come (its sentence is shown while one is left in `root`). */
export function mapTilesFailedIn(root: ParentNode): boolean {
    return !blocked && !!root.querySelector(`${TILE_SELECTOR}[data-tile-state="failed"]`);
}

/**
 * The corner sentence of a map whose tiles did not come (§10.1: an error, `role=alert`, with Try again). The
 * button keeps its press from the map's drag and click.
 */
export function tilesFailedNote(retry: () => void): HTMLElement {
    const note = document.createElement('div');
    note.className = 'busy-msg is-err map-tiles-failed';
    note.setAttribute('role', 'alert');
    const text = document.createElement('span');
    text.className = 'busy-msg__text';
    text.textContent = strings.busy.tilesFailed;
    const again = document.createElement('button');
    again.type = 'button';
    again.className = 'link busy-msg__retry';
    again.textContent = strings.busy.retry;
    for (const type of ['pointerdown', 'mousedown', 'touchstart']) {
        again.addEventListener(type, e => e.stopPropagation());
    }
    // A small map moves on its arrows and +/−: not while the button has the focus (Escape still goes through).
    again.addEventListener('keydown', e => { if (e.key !== 'Escape' && e.key !== 'Tab') e.stopPropagation(); });
    again.addEventListener('click', e => {
        e.stopPropagation();
        note.remove();
        retry();
    });
    note.append(text, again);
    return note;
}

/** Try again: the tiles of `root` that did not come are asked for once more. */
export function retryMapTiles(root: ParentNode): void {
    for (const img of Array.from(root.querySelectorAll<HTMLImageElement>(`${TILE_SELECTOR}[data-tile-state="failed"]`))) {
        const url = img.dataset.tileUrl;
        // The same address set again is asked again (an <img> reloads on every set of src).
        if (url) loadMapTile(img, url);
    }
}

const REQUEST_INIT: RequestInit = {
    credentials: 'omit',
    // The request's own policy wins over the page's: the origin is always sent.
    referrerPolicy: 'strict-origin-when-cross-origin',
};

/** Read one plain tile request once, to see whether the server refuses them. */
async function probe(url: string): Promise<void> {
    try {
        const res = await fetch(url, REQUEST_INIT);
        if (overloaded(res.status)) return;  // a request limit says nothing of a refusal
        if (!isBlockedTileResponse(res.status, res.headers.get('cache-control'))) return;
    } catch {
        return;  // offline, or the response is not readable: nothing learned
    }
    if (access !== 'plain') return;
    access = 'tagged';
    changed();
}

function refuse(): void {
    if (blocked) return;
    blocked = true;
    changed();
}

/** Load (or reload) one tile image. */
export function loadMapTile(img: HTMLImageElement, url: string): void {
    releaseMapTile(img);
    img.dataset.tileUrl = url;
    if (blocked) {
        img.dataset.tileAccess = 'blocked';
        img.removeAttribute('src');
        return;
    }
    const mode = currentAccess();
    img.dataset.tileAccess = mode;
    watch(img);
    // A late tile still shows (and takes its sentence away); a tagged request is stopped at the limit.
    timers.set(img, setTimeout(() => {
        timers.delete(img);
        if (img.dataset.tileState === 'loaded') return;
        const ctrl = pending.get(img);
        if (ctrl) { pending.delete(img); ctrl.abort(); }
        failed(img);
    }, TILE_TIMEOUT_MS));
    if (mode === 'plain') {
        img.referrerPolicy = 'strict-origin-when-cross-origin';
        img.src = url;
        if (!probed) {
            probed = true;
            void probe(url);
        }
        return;
    }
    img.removeAttribute('src');
    const ctrl = new AbortController();
    pending.set(img, ctrl);
    fetch(url, { ...REQUEST_INIT, headers: { 'X-Requested-With': TILE_REQUESTED_WITH }, signal: ctrl.signal })
        .then(async res => {
            if (overloaded(res.status)) {
                failed(img);
                return;
            }
            if (isBlockedTileResponse(res.status, res.headers.get('cache-control'))) {
                refuse();
                return;
            }
            const blob = await res.blob();
            if (ctrl.signal.aborted) return;
            const objectUrl = URL.createObjectURL(blob);
            const free = () => URL.revokeObjectURL(objectUrl);
            img.addEventListener('load', free, { once: true });
            img.addEventListener('error', free, { once: true });
            img.src = objectUrl;
        })
        // Offline: the tile is failed (its sentence, Try again); aborted (the tile left the view, or
        // the limit, which said so itself): nothing more.
        .catch(() => { if (!ctrl.signal.aborted) failed(img); })
        .finally(() => { if (pending.get(img) === ctrl) pending.delete(img); });
}

/**
 * One tile read as a picture for an output (spec 145 T3: the cut of the map around a house), the way the map asks
 * for tiles (the page's Referer, or the app id where none is sent). Throws when it does not come or is refused
 * (a refusal ends tile loading for the page's life, as on the map).
 */
export async function fetchMapTileBlob(url: string, signal: AbortSignal): Promise<Blob> {
    if (blocked) throw new Error('tiles refused');
    const tagged = currentAccess() === 'tagged';
    const res = await fetch(url, { ...REQUEST_INIT, signal, ...(tagged ? { headers: { 'X-Requested-With': TILE_REQUESTED_WITH } } : {}) });
    if (overloaded(res.status)) throw new Error(`tile ${res.status}`);
    if (isBlockedTileResponse(res.status, res.headers.get('cache-control'))) {
        if (tagged) refuse();
        throw new Error('tile refused');
    }
    return res.blob();
}

/** A tile leaves the view (or is asked for anew): stop a request still on its way, its limit and its failure. */
export function releaseMapTile(img: HTMLImageElement): void {
    settled(img, null);
    const ctrl = pending.get(img);
    if (ctrl) {
        pending.delete(img);
        ctrl.abort();
    }
}

/** Back to the start of a page's life (tests). */
export function resetMapTilesForTests(): void {
    access = null;
    probed = false;
    blocked = false;
    telling = false;
    listeners.clear();
}
