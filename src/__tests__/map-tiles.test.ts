/**
 * Tile loading within the OpenStreetMap tile policy (src/ui/map-tiles.ts):
 * plain <img> with an explicit Referrer-Policy over http(s), one probe that
 * notices the server's 200 "Access blocked" picture, the switch to requests
 * tagged with X-Requested-With, and the one note when even those are refused.
 * The DOM, fetch and blob URLs are stubbed (the suite runs without a DOM).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { loadMapTile, mapTilesBlocked, onMapTilesChange, releaseMapTile, resetMapTilesForTests } from '../ui/map-tiles.js';
import { TILE_REQUESTED_WITH } from '../map.js';

interface FakeImg {
    dataset: Record<string, string>;
    src?: string;
    referrerPolicy?: string;
    removeAttribute(name: string): void;
    addEventListener(): void;
}

function fakeImg(): FakeImg {
    return {
        dataset: {},
        removeAttribute(name: string) { if (name === 'src') delete this.src; },
        addEventListener() { /* load/error: the blob URL is freed, not observed here */ },
    };
}

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
afterEach(() => vi.unstubAllGlobals());

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
