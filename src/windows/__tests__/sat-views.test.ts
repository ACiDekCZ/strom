/**
 * A satellite's own view and its further windows (spec 079 §2 K2): the
 * header names the tree alone beside the view switcher; the narrow switcher's
 * menu goes round with the arrows; a switched view is written into the
 * window's address; ⧉ opens a window of the same view by the address, name
 * and size of §1 and announces its starting state to the main window, which
 * hands it over at that window's hello and lists it.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DataManager } from '../../data.js';
import { TreeManager } from '../../tree-manager.js';
import { AuditLogManager } from '../../audit-log.js';
import { UndoManager } from '../../undo.js';
import type { StromData, TreeId } from '../../types.js';
import { WindowBus, createMemoryHub, type WindowMessage } from '../window-bus.js';
import { WindowRegistry, dataManagerHost } from '../window-registry.js';
import { SatelliteClient } from '../satellite.js';
import { satHeaderTitle, menuKeyTarget, SAT_VIEWS, SAT_SEGMENT_MIN_WIDTH } from '../sat-header.js';
import { satelliteHrefWithKind, openWindowFromSatellite, type OpenAnotherDeps } from '../sat-views.js';
import type { LocksLike } from '../window-role.js';

describe('the header', () => {
    it('with the view switcher the name is the tree alone; without it the tree and the view', () => {
        expect(satHeaderTitle('Vrtišek', 'map', true)).toBe('Vrtišek');
        expect(satHeaderTitle('', 'map', true)).toBe('');
        expect(satHeaderTitle('Vrtišek', 'table')).toBe('Vrtišek · Table');
        expect(satHeaderTitle('', 'table')).toBe('Table');
    });

    it('switches between the six views in the order of the view tabs; the tabs from 960 px', () => {
        expect(SAT_VIEWS).toEqual(['family', 'descendants', 'timeline', 'fan', 'map', 'table']);
        expect(SAT_SEGMENT_MIN_WIDTH).toBe(960);
    });

    it('the menu\'s keys: the arrows go round, Home and End to the ends, others nothing', () => {
        expect(menuKeyTarget('ArrowDown', -1, 6)).toBe(0);
        expect(menuKeyTarget('ArrowDown', 5, 6)).toBe(0);
        expect(menuKeyTarget('ArrowUp', 0, 6)).toBe(5);
        expect(menuKeyTarget('ArrowUp', -1, 6)).toBe(5);
        expect(menuKeyTarget('Home', 3, 6)).toBe(0);
        expect(menuKeyTarget('End', 1, 6)).toBe(5);
        expect(menuKeyTarget('Enter', 1, 6)).toBe(-1);
        expect(menuKeyTarget('ArrowDown', -1, 0)).toBe(-1);
    });

    it('a switched view goes into the window\'s address, the rest kept', () => {
        expect(satelliteHrefWithKind('https://beta.stromapp.info/run/?okno=table&tree=t1&w=ab12cd34#x', 'map'))
            .toBe('https://beta.stromapp.info/run/?okno=map&tree=t1&w=ab12cd34#x');
        expect(satelliteHrefWithKind('file:///Users/x/strom.html?okno=family&w=ab12cd34', 'fan'))
            .toBe('file:///Users/x/strom.html?okno=fan&w=ab12cd34');
    });
});

const TREE = 'sv-tree' as TreeId;

function noLocks(): LocksLike {
    return { request: (_n, _o, cb) => Promise.resolve(cb(null)), query: async () => ({ held: [] }) };
}

describe('another window from a satellite', () => {
    let hub: ReturnType<typeof createMemoryHub>;
    let registry: WindowRegistry;
    let sat: SatelliteClient;
    let mainOpened: { url: string; name: string; features: string }[];
    const mainWin = { closed: false, focus: vi.fn(), close: vi.fn() };

    async function settle(ms = 0): Promise<void> {
        await hub.flush();
        await vi.advanceTimersByTimeAsync(ms);
        await hub.flush();
    }

    beforeEach(async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-11-12T10:00:00Z'));
        vi.spyOn(TreeManager, 'saveTreeData').mockImplementation(() => {});
        vi.spyOn(AuditLogManager, 'log').mockImplementation(() => {});
        const dm = DataManager as unknown as { data: StromData; currentTreeId: TreeId | null; viewMode: boolean; pendingBefore: StromData | null; liveTreeId: TreeId | null };
        dm.data = { persons: {}, partnerships: {} } as StromData;
        dm.currentTreeId = TREE;
        dm.viewMode = false;
        dm.pendingBefore = null;
        dm.liveTreeId = null;
        UndoManager.setActiveTree(null);
        UndoManager.setActiveTree(TREE);
        DataManager.createPerson({ firstName: 'Ludmila', lastName: 'Šťovíčková', gender: 'female' });
        hub = createMemoryHub();
        mainOpened = [];
        registry = new WindowRegistry({
            bus: new WindowBus('main-1', hub.channel()),
            host: dataManagerHost({ treeName: () => 'Šťovíčkovi', treeExists: () => true, focusSelf: () => {}, hasFocus: () => true }),
            openWindow: (url, name, features) => { mainOpened.push({ url, name, features }); return mainWin as unknown as Window; },
            geometry: () => null,
        });
        registry.start();
        // A satellite of the map the main window opened.
        const satId = registry.openSatellite('map', { kind: 'map' })!;
        mainOpened.length = 0;
        sat = new SatelliteClient({ kind: 'map', treeId: TREE, windowId: satId, newId: false }, {
            bus: new WindowBus(satId, hub.channel()),
            data: { setWindowSink: () => {}, loadFromWindow: () => {}, windowDataJson: () => '{}', isEditSessionActive: () => false },
            storage: null, locks: noLocks(), closeSelf: () => {}, hasFocus: () => true, bounds: () => undefined,
        });
        sat.start();
        await settle();
    });

    afterEach(() => {
        sat.stop();
        registry.stop();
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    function deps(over: Partial<OpenAnotherDeps> = {}): OpenAnotherDeps & { calls: { url: string; name: string; features: string }[] } {
        const calls: { url: string; name: string; features: string }[] = [];
        return {
            calls,
            open: (url, name, features) => { calls.push({ url, name, features }); return {} as Window; },
            geometry: () => ({ screenX: 100, screenY: 50, outerWidth: 1000, outerHeight: 750, availLeft: 0, availTop: 0, availWidth: 2560, availHeight: 1400 }),
            startState: (kind) => ({ kind, center: { lat: 49.2, lon: 16.6 }, zoom: 9 }),
            newId: () => 'cafe0001',
            ...over,
        };
    }

    it('a switched view: the main window\'s list names it; a hello after a reload says it too', async () => {
        sat.setKind('fan');
        await settle();
        expect(registry.list()[0]).toMatchObject({ id: sat.windowId, kind: 'fan' });
        // A reload of the main window: the satellite says hello with its view now.
        const seen: WindowMessage[] = [];
        const probe = new WindowBus('probe', hub.channel());
        probe.onAny(m => seen.push(m));
        probe.post({ type: 'status', live: false, locked: false, readOnly: false, researchState: null, treeExists: true, treeId: TREE, treeName: 'Šťovíčkovi', revision: 1, canUndo: false, canRedo: false, windows: [] });
        await settle(1500);
        probe.post({ type: 'status', live: false, locked: false, readOnly: false, researchState: null, treeExists: true, treeId: TREE, treeName: 'Šťovíčkovi', revision: 1, canUndo: false, canRedo: false, windows: [] });
        await settle();
        expect(seen.filter(m => m.type === 'hello').slice(-1)[0]).toMatchObject({ windowId: sat.windowId, kind: 'fan' });
        probe.close();
    });

    it('opens the same view by the address, name and size of §1, beside this window', async () => {
        const d = deps();
        expect(openWindowFromSatellite(sat, d)).toBe('cafe0001');
        expect(d.calls).toEqual([{ url: `?okno=map&tree=${TREE}&w=cafe0001`, name: 'strom-w-cafe0001', features: 'popup,width=1000,height=750,left=1100,top=50' }]);
    });

    it('the new window says hello: the main window lists it and hands it this window\'s state, then the tree', async () => {
        openWindowFromSatellite(sat, deps());
        await settle();
        expect(registry.size).toBe(1);   // listed at its hello, not before
        const got: WindowMessage[] = [];
        const next = new WindowBus('cafe0001', hub.channel());
        next.onAny(m => got.push(m));
        next.post({ type: 'hello', windowId: 'cafe0001', kind: 'map', treeId: TREE });
        await settle();
        const init = got.filter(m => m.type === 'init');
        expect(init).toEqual([expect.objectContaining({ to: 'cafe0001', kind: 'map', state: { kind: 'map', center: { lat: 49.2, lon: 16.6 }, zoom: 9 } })]);
        expect(got.findIndex(m => m.type === 'init')).toBeLessThan(got.findIndex(m => m.type === 'tree'));
        expect(registry.list().map(e => [e.id, e.kind, e.opened])).toEqual([[sat.windowId, 'map', true], ['cafe0001', 'map', false]]);
        next.close();
    });

    it('a window it opened is brought forward by its name; one of an unknown opener only by a message', async () => {
        openWindowFromSatellite(sat, deps());
        await settle();
        const next = new WindowBus('cafe0001', hub.channel());
        next.post({ type: 'hello', windowId: 'cafe0001', kind: 'map', treeId: TREE });
        const foreign = new WindowBus('f00d0001', hub.channel());
        foreign.post({ type: 'hello', windowId: 'f00d0001', kind: 'table', treeId: TREE });
        await settle();
        void registry.focusWindow('cafe0001');
        expect(mainOpened).toEqual([{ url: '', name: 'strom-w-cafe0001', features: '' }]);
        void registry.focusWindow('f00d0001');
        expect(mainOpened).toHaveLength(1);
        await settle(400);
        next.close();
        foreign.close();
    });

    it('blocked by the browser: null, nothing announced', async () => {
        const seen: WindowMessage[] = [];
        const probe = new WindowBus('probe2', hub.channel());
        probe.onAny(m => seen.push(m));
        expect(openWindowFromSatellite(sat, deps({ open: () => null }))).toBeNull();
        await settle();
        expect(seen.filter(m => m.type === 'spawn')).toHaveLength(0);
        probe.close();
    });
});
