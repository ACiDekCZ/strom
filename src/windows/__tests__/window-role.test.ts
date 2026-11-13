/**
 * The window's role at start (spec 079 §0): `okno=` makes a satellite, the
 * free lock the main window, a held lock a second tab; an exported file or a
 * browser without locks or channels has no role. A window never queues for
 * the lock.
 */

import { describe, it, expect } from 'vitest';
import {
    decideWindowRole, tryBecomeMain, isMainAlive, parseSatelliteParams, satelliteUrl, satelliteViewMode,
    MAIN_LOCK, type LocksLike,
} from '../window-role.js';
import { placeNextTo } from '../window-registry.js';
import type { TreeId } from '../../types.js';

/** navigator.locks for one origin: exclusive locks, `ifAvailable` only (no queue). */
function fakeLocks(): LocksLike & { held: Set<string>; queued: number } {
    const held = new Set<string>();
    const locks = {
        held,
        queued: 0,
        request(name: string, options: { ifAvailable: boolean }, cb: (lock: unknown) => unknown): Promise<unknown> {
            if (held.has(name)) {
                if (!options.ifAvailable) locks.queued++;
                return Promise.resolve(cb(null));
            }
            held.add(name);
            return Promise.resolve(cb({ name })).finally(() => held.delete(name));
        },
        async query() {
            return { held: [...held].map(name => ({ name })) };
        },
    };
    return locks;
}

describe('window role at start', () => {
    it('an address with okno= is a satellite and takes no lock', async () => {
        const locks = fakeLocks();
        const d = await decideWindowRole({ search: '?okno=table&tree=t1&w=ab12cd34', embedded: false, locks, hasChannel: true });
        expect(d.role).toBe('satellite');
        expect(d.satellite).toEqual({ kind: 'table', treeId: 't1', windowId: 'ab12cd34', newId: false });
        expect(locks.held.size).toBe(0);
    });

    it('the first window takes the free lock and holds it: main', async () => {
        const locks = fakeLocks();
        const d = await decideWindowRole({ search: '', embedded: false, locks, hasChannel: true });
        expect(d.role).toBe('main');
        expect(locks.held.has(MAIN_LOCK)).toBe(true);
        // Held for the window's life, not released by itself.
        await new Promise(r => setTimeout(r, 0));
        expect(locks.held.has(MAIN_LOCK)).toBe(true);
    });

    it('a second window while the lock is held: second tab, without queueing for the lock', async () => {
        const locks = fakeLocks();
        await decideWindowRole({ search: '', embedded: false, locks, hasChannel: true });
        const d = await decideWindowRole({ search: '?person=x', embedded: false, locks, hasChannel: true });
        expect(d.role).toBe('second-tab');
        expect(locks.queued).toBe(0);
    });

    it('an exported file (view mode) has no role, nor a browser without locks or BroadcastChannel', async () => {
        expect((await decideWindowRole({ search: '?okno=table', embedded: true, locks: fakeLocks(), hasChannel: true })).role).toBe('none');
        expect((await decideWindowRole({ search: '', embedded: false, locks: null, hasChannel: true })).role).toBe('none');
        expect((await decideWindowRole({ search: '', embedded: false, locks: fakeLocks(), hasChannel: false })).role).toBe('none');
    });

    it('"make this the main window" gets the lock only once the main window let it go', async () => {
        const locks = fakeLocks();
        const main = await tryBecomeMain(locks);
        expect(main).not.toBeNull();
        expect(await tryBecomeMain(locks)).toBeNull();
        expect(await isMainAlive(locks)).toBe(true);
        main!.release();
        await new Promise(r => setTimeout(r, 0));
        expect(await isMainAlive(locks)).toBe(false);
        expect(await tryBecomeMain(locks)).not.toBeNull();
    });
});

describe('satellite address', () => {
    it('round-trips kind, tree and window id', () => {
        const url = satelliteUrl('table', 'tree-1' as TreeId, 'w1234567');
        expect(url.startsWith('?')).toBe(true);
        expect(parseSatelliteParams(url)).toEqual({ kind: 'table', treeId: 'tree-1', windowId: 'w1234567', newId: false });
    });

    it('keeps the app\'s own address: the web app, a file served by name, a file opened from disk', () => {
        const url = satelliteUrl('table', 'tree-1' as TreeId, 'w1234567');
        expect(new URL(url, 'https://stromapp.info/run/').pathname).toBe('/run/');
        expect(new URL(url, 'http://127.0.0.1:8742/strom.html').pathname).toBe('/strom.html');
        expect(new URL(url, 'file:///Users/someone/Desktop/strom.html?x=1').href).toBe('file:///Users/someone/Desktop/strom.html?okno=table&tree=tree-1&w=w1234567');
    });

    it('a kind this version does not know opens the Table; the overview window stands for no tree view (as the main window: Family)', () => {
        expect(parseSatelliteParams('?okno=chart3d&w=abcd1234')!.kind).toBe('table');
        expect(parseSatelliteParams('?okno=fan&w=abcd1234')!.kind).toBe('fan');
        expect(parseSatelliteParams('?okno=overview&w=abcd1234')!.kind).toBe('overview');
        expect(satelliteViewMode('overview')).toBe('family');
        expect(satelliteViewMode('map')).toBe('map');
    });

    it('a missing or malformed window id gets a new one (said, so the address can be written again)', () => {
        const p = parseSatelliteParams('?okno=table&w=<x>')!;
        expect(p.newId).toBe(true);
        expect(p.windowId).toMatch(/^[0-9a-f]{8}$/);
        expect(parseSatelliteParams('?tree=x')).toBeNull();
    });
});

describe('placing a new window next to the main one (§7)', () => {
    const g = { screenX: 0, screenY: 40, outerWidth: 1000, outerHeight: 900, availLeft: 0, availTop: 0, availWidth: 2560, availHeight: 1400 };

    it('right of the main window when it fits', () => {
        expect(placeNextTo(1200, 800, g)).toEqual({ left: 1000, top: 40, width: 1200, height: 800 });
    });

    it('left of it when only that side fits', () => {
        expect(placeNextTo(1200, 800, { ...g, screenX: 1400, outerWidth: 1100 })).toEqual({ left: 200, top: 40, width: 1200, height: 800 });
    });

    it('over it, shifted for every window already open, cut to the screen', () => {
        const small = { ...g, screenX: 100, outerWidth: 1300, availWidth: 1440, availHeight: 700 };
        expect(placeNextTo(1200, 800, small, 0)).toEqual({ left: 132, top: 0, width: 1200, height: 700 });
        expect(placeNextTo(1200, 800, small, 1).left).toBe(164);
    });
});
