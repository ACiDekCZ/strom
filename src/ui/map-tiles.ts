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
 */

import { initialTileAccess, isBlockedTileResponse, TILE_REQUESTED_WITH, type TileAccess } from '../map.js';

let access: TileAccess | null = null;
let probed = false;
let blocked = false;
const listeners = new Set<() => void>();
const pending = new WeakMap<HTMLImageElement, AbortController>();

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

/** Called after the way tiles are loaded changed, or they were refused. Returns the unsubscribe. */
export function onMapTilesChange(fn: () => void): () => void {
    listeners.add(fn);
    return () => listeners.delete(fn);
}

function changed(): void {
    // Tiles drawn the old way are loaded again (or emptied when refused).
    for (const img of Array.from(document.querySelectorAll<HTMLImageElement>(TILE_SELECTOR))) {
        const url = img.dataset.tileUrl;
        if (url && img.dataset.tileAccess !== (blocked ? 'blocked' : currentAccess())) loadMapTile(img, url);
    }
    for (const fn of listeners) fn();
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
        // Offline, aborted (the tile left the view): the tile stays empty, no retry.
        .catch(() => undefined)
        .finally(() => { if (pending.get(img) === ctrl) pending.delete(img); });
}

/** A tile leaves the view: stop a request still on its way. */
export function releaseMapTile(img: HTMLImageElement): void {
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
    listeners.clear();
}
