/**
 * Tile loading within the OpenStreetMap tile policy (src/ui/map-tiles.ts):
 * plain <img> with an explicit Referrer-Policy over http(s), one probe that
 * notices the server's 200 "Access blocked" picture, the switch to requests
 * tagged with X-Requested-With, and the one note when even those are refused.
 * The DOM, fetch and blob URLs are stubbed (the suite runs without a DOM).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { loadMapTile, mapTilesBlocked, mapTilesFailedIn, onMapTilesChange, releaseMapTile, resetMapTilesForTests, retryMapTiles, TILE_TIMEOUT_MS } from '../ui/map-tiles.js';
import { TILE_REQUESTED_WITH } from '../map.js';

interface FakeImg {
    dataset: Record<string, string>;
    src?: string;
    referrerPolicy?: string;
    removeAttribute(name: string): void;
    getAttribute(name: string): string | null;
    addEventListener(type: string, fn: () => void): void;
    /** The browser's answer to the image: it came, or it did not. */
    fire(type: 'load' | 'error'): void;
}

function fakeImg(): FakeImg {
    const on: Record<string, (() => void)[]> = {};
    return {
        dataset: {},
        removeAttribute(name: string) { if (name === 'src') delete this.src; },
        getAttribute(name: string) { return name === 'src' ? this.src ?? null : null; },
        addEventListener(type: string, fn: () => void) { (on[type] ??= []).push(fn); },
        fire(type) { for (const fn of on[type] ?? []) fn(); },
    };
}

/** The maps' root: finds the drawn tiles still failed (as `img.map-tile[data-tile-state="failed"]`). */
const root = {
    querySelector: () => imgs.find(i => i.dataset.tileState === 'failed') ?? null,
    querySelectorAll: () => imgs.filter(i => i.dataset.tileState === 'failed'),
} as unknown as ParentNode;

const URL_A = 'https://tile.openstreetmap.org/5/17/10.png';
const URL_B = 'https://tile.openstreetmap.org/5/18/10.png';
const TILE = { status: 200, cc: 'max-age=88056, stale-while-revalidate=604800' };
const REFUSED = { status: 200, cc: 'no-cache' };

let imgs: FakeImg[];
let calls: { url: string; init: RequestInit }[];
/** What the server answers: per request, by whether it carries X-Requested-With. */
let answer: (tagged: boolean) => { status: number; cc: string };

function stub(protocol: string): void {
    vi.stubGlobal('location', { protocol });
    vi.stubGlobal('document', { querySelectorAll: () => imgs });
    vi.stubGlobal('URL', { createObjectURL: () => 'blob:tile', revokeObjectURL: () => undefined });
    vi.stubGlobal('fetch', (url: string, init: RequestInit) => {
        calls.push({ url, init });
        const tagged = !!(init.headers as Record<string, string> | undefined)?.['X-Requested-With'];
        const a = answer(tagged);
        if (init.signal?.aborted) return Promise.reject(new Error('aborted'));
        return Promise.resolve({
            status: a.status,
            headers: { get: (h: string) => (h === 'cache-control' ? a.cc : null) },
            blob: () => Promise.resolve({}),
        });
    });
}

function load(url: string): FakeImg {
    const img = fakeImg();
    imgs.push(img);
    loadMapTile(img as unknown as HTMLImageElement, url);
    return img;
}

const settle = () => new Promise(r => setTimeout(r, 0));

beforeEach(() => {
    resetMapTilesForTests();
    imgs = [];
    calls = [];
    answer = () => TILE;
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('map tiles', () => {
    it('over https a tile is a plain image that sends the origin as Referer; one probe, untagged', async () => {
        stub('https:');
        const a = load(URL_A);
        const b = load(URL_B);
        await settle();
        expect(a.src).toBe(URL_A);
        expect(a.referrerPolicy).toBe('strict-origin-when-cross-origin');
        expect(b.src).toBe(URL_B);
        // Only the first tile is read again, once for the page's life.
        expect(calls.map(c => c.url)).toEqual([URL_A]);
        expect(calls[0].init.headers).toBeUndefined();
        expect(calls[0].init.referrerPolicy).toBe('strict-origin-when-cross-origin');
        expect(calls[0].init.cache).toBeUndefined();  // the HTTP cache is never bypassed
        expect(mapTilesBlocked()).toBe(false);
    });

    it('the "Access blocked" picture switches every drawn tile to tagged requests', async () => {
        stub('https:');
        answer = tagged => (tagged ? TILE : REFUSED);
        let told = 0;
        onMapTilesChange(() => { told++; });
        const a = load(URL_A);
        const b = load(URL_B);
        await settle();
        await settle();
        expect(told).toBe(1);
        expect(mapTilesBlocked()).toBe(false);
        const tagged = calls.filter(c => (c.init.headers as Record<string, string> | undefined)?.['X-Requested-With'] === TILE_REQUESTED_WITH);
        expect(tagged.map(c => c.url).sort()).toEqual([URL_A, URL_B]);
        expect(a.src).toBe('blob:tile');
        expect(b.src).toBe('blob:tile');
        expect(a.dataset.tileAccess).toBe('tagged');
    });

    it('a page opened as a file tags its requests from the first tile (no Referer exists there)', async () => {
        stub('file:');
        const a = load(URL_A);
        expect(a.src).toBeUndefined();
        await settle();
        expect(calls).toHaveLength(1);
        expect((calls[0].init.headers as Record<string, string>)['X-Requested-With']).toBe(TILE_REQUESTED_WITH);
        expect(a.src).toBe('blob:tile');
    });

    it('a refusal of the tagged requests ends tile loading: tiles emptied, told once, nothing more asked', async () => {
        stub('file:');
        answer = () => REFUSED;
        let told = 0;
        onMapTilesChange(() => { told++; });
        const a = load(URL_A);
        const b = load(URL_B);
        await settle();
        expect(mapTilesBlocked()).toBe(true);
        expect(told).toBe(1);
        expect(a.src).toBeUndefined();
        expect(b.src).toBeUndefined();
        const asked = calls.length;
        const c = load('https://tile.openstreetmap.org/5/19/10.png');
        await settle();
        expect(calls.length).toBe(asked);
        expect(c.src).toBeUndefined();
    });

    it('a tile that leaves the view before it arrives is aborted', async () => {
        stub('file:');
        const a = load(URL_A);
        releaseMapTile(a as unknown as HTMLImageElement);
        expect(calls[0].init.signal?.aborted).toBe(true);
        await settle();
        expect(a.src).toBeUndefined();
    });

    it('a probe that cannot be read (offline, CORS) changes nothing', async () => {
        stub('https:');
        vi.stubGlobal('fetch', () => Promise.reject(new TypeError('Failed to fetch')));
        const a = load(URL_A);
        await settle();
        expect(a.src).toBe(URL_A);
        expect(a.dataset.tileAccess).toBe('plain');
        expect(mapTilesBlocked()).toBe(false);
    });
});

/** §10.3: a tile waits 15 s at most; one that did not come is said once on its map, with Try again. */
describe('map tiles that did not come', () => {
    const flush = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };

    it('a plain tile without an answer in 15 s is failed and the maps are told; a late tile takes it away', async () => {
        vi.useFakeTimers();
        stub('https:');
        let told = 0;
        onMapTilesChange(() => { told++; });
        const a = load(URL_A);
        const b = load(URL_B);
        b.fire('load');
        await vi.advanceTimersByTimeAsync(TILE_TIMEOUT_MS - 1);
        expect(mapTilesFailedIn(root)).toBe(false);
        await vi.advanceTimersByTimeAsync(1);
        await flush();
        expect(a.dataset.tileState).toBe('failed');
        expect(b.dataset.tileState).toBe('loaded');
        expect(mapTilesFailedIn(root)).toBe(true);
        expect(told).toBe(1);
        a.fire('load');
        await flush();
        expect(mapTilesFailedIn(root)).toBe(false);
        expect(told).toBe(2);
    });

    it('offline: every tile fails at once, the maps are told once; Try again asks again and the sentence goes', async () => {
        stub('file:');
        vi.stubGlobal('fetch', (_url: string, init: RequestInit) => {
            calls.push({ url: _url, init });
            return Promise.reject(new TypeError('Failed to fetch'));
        });
        let told = 0;
        onMapTilesChange(() => { told++; });
        load(URL_A);
        load(URL_B);
        await settle();
        expect(imgs.every(i => i.dataset.tileState === 'failed')).toBe(true);
        expect(told).toBe(1);
        expect(mapTilesBlocked()).toBe(false);
        stub('file:');  // the network is back
        retryMapTiles(root);
        expect(mapTilesFailedIn(root)).toBe(false);
        await settle();
        expect(imgs.map(i => i.src)).toEqual(['blob:tile', 'blob:tile']);
    });

    it('a tagged request without an answer is stopped at 15 s and failed (not refused)', async () => {
        vi.useFakeTimers();
        stub('file:');
        vi.stubGlobal('fetch', (url: string, init: RequestInit) => {
            calls.push({ url, init });
            return new Promise(() => undefined);
        });
        const a = load(URL_A);
        await vi.advanceTimersByTimeAsync(TILE_TIMEOUT_MS);
        await flush();
        expect(calls[0].init.signal?.aborted).toBe(true);
        expect(a.dataset.tileState).toBe('failed');
        expect(mapTilesBlocked()).toBe(false);
    });

    it('the server\'s request limit (429) fails the tile and does not end tile loading', async () => {
        stub('file:');
        answer = () => ({ status: 429, cc: 'no-cache' });
        const a = load(URL_A);
        await settle();
        expect(a.dataset.tileState).toBe('failed');
        expect(mapTilesBlocked()).toBe(false);
    });

    it('a plain image that errors is failed; a failed tile panned away is no longer counted', async () => {
        stub('https:');
        const a = load(URL_A);
        a.fire('error');
        expect(a.dataset.tileState).toBe('failed');
        releaseMapTile(a as unknown as HTMLImageElement);
        expect(mapTilesFailedIn(root)).toBe(false);
    });
});
