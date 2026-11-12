/**
 * The main window's registry of satellite windows (spec 079 §0, §4): a
 * satellite's hello gets the starting state and the tree; an edit on the
 * present revision is saved as this window's own (an undo step with its
 * label) and goes to every window as a patch; an edit on an older revision is
 * refused and only that window gets the fresh tree; undo from a satellite;
 * the list follows hello, bye and closed windows; the selection does not loop.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DataManager } from '../../data.js';
import { TreeManager } from '../../tree-manager.js';
import { AuditLogManager } from '../../audit-log.js';
import { UndoManager } from '../../undo.js';
import { LAST_FOCUSED, type StromData, type TreeId, type Person } from '../../types.js';
import { WindowBus, createMemoryHub, type WindowMessage } from '../window-bus.js';
import { WindowRegistry, dataManagerHost, PATCH_INTERVAL_MS } from '../window-registry.js';

const last = <T>(xs: T[]): T | undefined => xs[xs.length - 1];

const TREE = 'reg-tree' as TreeId;

function resetData(): void {
    const dm = DataManager as unknown as { data: StromData; currentTreeId: TreeId | null; viewMode: boolean; pendingBefore: StromData | null; liveTreeId: TreeId | null };
    dm.data = { persons: {}, partnerships: {} };
    dm.currentTreeId = TREE;
    dm.viewMode = false;
    dm.pendingBefore = null;
    dm.liveTreeId = null;
    UndoManager.setActiveTree(null);
    UndoManager.setActiveTree(TREE);
}

/** A satellite's end of the channel that records what reaches it. */
function listener(hub: ReturnType<typeof createMemoryHub>, id: string) {
    const bus = new WindowBus(id, hub.channel());
    const got: WindowMessage[] = [];
    bus.onAny(m => got.push(m));
    return { bus, got, of: <T extends WindowMessage['type']>(t: T) => got.filter(m => m.type === t) as Extract<WindowMessage, { type: T }>[] };
}

interface FakeWin { closed: boolean; focus: () => void; close: () => void }
function fakeWindow(): FakeWin {
    const w: FakeWin = { closed: false, focus: vi.fn(), close: () => { w.closed = true; } };
    return w;
}

let hub: ReturnType<typeof createMemoryHub>;
let registry: WindowRegistry;
let saveSpy: ReturnType<typeof vi.spyOn>;
let treeName = 'Okurkovi';
let opened: { url: string; name: string; features: string; win: FakeWin }[];

async function settle(ms = 0): Promise<void> {
    await hub.flush();
    await vi.advanceTimersByTimeAsync(ms);
    await hub.flush();
}

beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-12T10:00:00Z'));
    saveSpy = vi.spyOn(TreeManager, 'saveTreeData').mockImplementation(() => {});
    vi.spyOn(AuditLogManager, 'log').mockImplementation(() => {});
    resetData();
    treeName = 'Okurkovi';
    DataManager.createPerson({ firstName: 'Zdislava', lastName: 'Okurková', gender: 'female' });
    UndoManager.clear();
    hub = createMemoryHub();
    opened = [];
    registry = new WindowRegistry({
        bus: new WindowBus('main-1', hub.channel()),
        host: dataManagerHost({ treeName: () => treeName, treeExists: () => true, focusSelf: () => {}, hasFocus: () => true }),
        openWindow: (url, name, features) => {
            const win = fakeWindow();
            opened.push({ url, name, features, win });
            return win as unknown as Window;
        },
        geometry: () => ({ screenX: 0, screenY: 0, outerWidth: 1000, outerHeight: 900, availLeft: 0, availTop: 0, availWidth: 2560, availHeight: 1400 }),
    });
    registry.start();
});

afterEach(() => {
    registry.stop();
    vi.useRealTimers();
    vi.restoreAllMocks();
});

/** Open a satellite from the registry and let it say hello. */
async function connect(initial?: unknown) {
    const id = registry.openSatellite('table', initial)!;
    const sat = listener(hub, id);
    sat.bus.post({ type: 'hello', windowId: id, kind: 'table', treeId: TREE });
    await settle();
    return { id, ...sat };
}

function treeOf(json: string): StromData {
    return JSON.parse(json) as StromData;
}

describe('opening and hello', () => {
    it('opens the window by the address and name of §1 and lists it', () => {
        const id = registry.openSatellite('table', { rowType: 'persons' });
        expect(id).toMatch(/^[0-9a-f]{8}$/);
        expect(opened[0].url).toBe(`?okno=table&tree=${TREE}&w=${id}`);
        expect(opened[0].name).toBe(`strom-w-${id}`);
        expect(opened[0].features).toBe('popup,width=1200,height=800,left=1000,top=0');
        expect(registry.list()).toEqual([expect.objectContaining({ id, kind: 'table', opened: true, connected: false })]);
    });

    it('a blocked window: null, nothing listed', () => {
        const blocked = new WindowRegistry({ bus: new WindowBus('main-2', hub.channel()), host: dataManagerHost(), openWindow: () => null, geometry: () => null });
        expect(blocked.openSatellite('table')).toBeNull();
        expect(blocked.size).toBe(0);
    });

    it('hello gets the starting state, then the whole tree and the status — only that window', async () => {
        const other = listener(hub, 'bystander');
        const sat = await connect({ rowType: 'persons', search: 'Okur' });
        expect(sat.of('init')).toEqual([expect.objectContaining({ to: sat.id, kind: 'table', state: { rowType: 'persons', search: 'Okur' } })]);
        const tree = sat.of('tree');
        expect(tree).toHaveLength(1);
        expect(tree[0]).toMatchObject({ to: sat.id, treeId: TREE, name: 'Okurkovi', revision: registry.revision });
        expect(Object.values(treeOf(tree[0].json).persons).map(p => (p as Person).firstName)).toEqual(['Zdislava']);
        expect(sat.got.findIndex(m => m.type === 'init')).toBeLessThan(sat.got.findIndex(m => m.type === 'tree'));
        expect(last(sat.of('status'))).toMatchObject({ treeId: TREE, treeExists: true, live: false, locked: false, windows: [sat.id] });
        expect(other.of('tree')).toHaveLength(0);
        expect(registry.list()[0].connected).toBe(true);
    });

    it('the status names the open tree; a rename reaches the windows', async () => {
        const sat = await connect();
        expect(last(sat.of('status'))).toMatchObject({ treeId: TREE, treeName: 'Okurkovi' });
        treeName = 'Okurkovi z Vranova';
        await settle(1000);
        expect(last(sat.of('status'))).toMatchObject({ treeId: TREE, treeName: 'Okurkovi z Vranova' });
    });

    it('the starting state goes once: a reloaded satellite keeps its own', async () => {
        const sat = await connect({ rowType: 'persons' });
        sat.bus.post({ type: 'hello', windowId: sat.id, kind: 'table', treeId: TREE });
        await settle();
        expect(sat.of('init')).toHaveLength(1);
        expect(sat.of('tree')).toHaveLength(2);
    });
});

describe('the main window\'s person with the tree', () => {
    it('a reloaded satellite and every window after a switch of trees get the person in the centre here with the tree', async () => {
        registry.stop();
        let focus: { personId: string; depthUp: number; depthDown: number } | null = { personId: 'p-zdislava', depthUp: 2, depthDown: 1 };
        registry = new WindowRegistry({
            bus: new WindowBus('main-3', hub.channel()),
            host: dataManagerHost({ treeName: () => treeName, treeExists: () => true, focusSelf: () => {}, hasFocus: () => true, focus: () => focus }),
            openWindow: () => fakeWindow() as unknown as Window,
            geometry: () => null,
        });
        registry.start();
        const sat = listener(hub, 'sat-f5');
        sat.bus.post({ type: 'hello', windowId: 'sat-f5', kind: 'family', treeId: TREE });
        await settle();
        expect(sat.of('tree')[0]).toMatchObject({ to: 'sat-f5', treeId: TREE, focus: { personId: 'p-zdislava', depthUp: 2, depthDown: 1 } });

        // Another tree opened here: its person goes with it to every window.
        (DataManager as unknown as { currentTreeId: TreeId }).currentTreeId = 'reg-tree-2' as TreeId;
        focus = { personId: 'p-other', depthUp: 3, depthDown: 2 };
        await settle(1000);
        await settle(PATCH_INTERVAL_MS);
        expect(last(sat.of('tree'))).toMatchObject({ treeId: 'reg-tree-2', replaces: { treeId: TREE }, focus: { personId: 'p-other', depthUp: 3, depthDown: 2 } });

        // No person here: the tree goes without one.
        focus = null;
        sat.bus.post({ type: 'hello', windowId: 'sat-f5', kind: 'family', treeId: 'reg-tree-2' as TreeId });
        await settle();
        expect(last(sat.of('tree'))).not.toHaveProperty('focus');
    });
});

describe('edits from a satellite', () => {
    it('on the present revision: saved as an edit here, an undo step with its label, a patch to all, revision + 1', async () => {
        const sat = await connect();
        const other = listener(hub, 'sat-b');
        const base = sat.of('tree')[0].revision;
        saveSpy.mockClear();
        const next = treeOf(sat.of('tree')[0].json);
        const p = Object.values(next.persons)[0] as Person;
        p.firstName = 'Zdislava Marie';
        sat.bus.post({ type: 'edit', windowId: sat.id, editId: 'e1', treeId: TREE, baseRevision: base, json: JSON.stringify(next), label: 'editing Zdislava Okurková' });
        await settle();

        expect(saveSpy).toHaveBeenCalledTimes(1);
        expect(DataManager.getPerson(p.id)!.firstName).toBe('Zdislava Marie');
        expect(DataManager.lastUndoDescription()).toBe('editing Zdislava Okurková');
        expect(AuditLogManager.log).toHaveBeenCalledWith(TREE, 'window.edit', 'editing Zdislava Okurková');
        const result = sat.of('edit-result');
        expect(result).toEqual([expect.objectContaining({ to: sat.id, editId: 'e1', ok: true, revision: base + 1 })]);

        await settle(PATCH_INTERVAL_MS);
        const patch = other.of('patch');
        expect(patch).toHaveLength(1);
        expect(patch[0].revision).toBe(base + 1);
        expect((treeOf(patch[0].json).persons[p.id] as Person).firstName).toBe('Zdislava Marie');

        // Undo here takes it back.
        DataManager.undo();
        expect(DataManager.getPerson(p.id)!.firstName).toBe('Zdislava');
    });

    it('on an older revision: refused, and only that window gets the fresh tree', async () => {
        const sat = await connect();
        const other = await connect();
        const base = sat.of('tree')[0].revision;
        DataManager.createPerson({ firstName: 'Bořivoj', lastName: 'Hrachovec', gender: 'male' });   // the main window changed meanwhile
        const stale = treeOf(sat.of('tree')[0].json);
        sat.bus.post({ type: 'edit', windowId: sat.id, editId: 'e2', treeId: TREE, baseRevision: base, json: JSON.stringify(stale), label: 'x' });
        const treesOther = other.of('tree').length;
        await settle();

        expect(sat.of('edit-result')).toEqual([expect.objectContaining({ ok: false, reason: 'revision', revision: base + 1 })]);
        const fresh = last(sat.of('tree'))!;
        expect(fresh.to).toBe(sat.id);
        expect(Object.keys(treeOf(fresh.json).persons)).toHaveLength(2);
        expect(other.of('tree')).toHaveLength(treesOther);
        expect(DataManager.getAllPersons()).toHaveLength(2);
    });

    it('refused while the tree follows a live research (read-only)', async () => {
        const sat = await connect();
        DataManager.setLiveTree(TREE);
        sat.bus.post({ type: 'edit', windowId: sat.id, editId: 'e3', treeId: TREE, baseRevision: registry.revision, json: '{"persons":{},"partnerships":{}}', label: 'x' });
        await settle();
        expect(last(sat.of('edit-result'))).toMatchObject({ ok: false, reason: 'read-only' });
        expect(DataManager.getAllPersons()).toHaveLength(1);
        expect(last(sat.of('status'))).toMatchObject({ live: true, readOnly: true });
    });

    it('undo from a satellite runs here; the result reaches the windows as a patch', async () => {
        const sat = await connect();
        DataManager.createPerson({ firstName: 'Bořivoj', lastName: 'Hrachovec', gender: 'male' });
        await settle(PATCH_INTERVAL_MS);
        const before = sat.of('patch').length;
        sat.bus.post({ type: 'undo' });
        await settle(PATCH_INTERVAL_MS);
        expect(DataManager.getAllPersons()).toHaveLength(1);
        const patch = sat.of('patch');
        expect(patch.length).toBe(before + 1);
        expect(Object.keys(treeOf(last(patch)!.json).persons)).toHaveLength(1);
        expect(last(sat.of('status'))).toMatchObject({ canUndo: false, canRedo: true });
    });

    it('a burst of saves makes one patch per half second', async () => {
        const sat = await connect();
        await settle(PATCH_INTERVAL_MS);
        const before = sat.of('patch').length;
        for (let i = 0; i < 5; i++) DataManager.createPerson({ firstName: `Bořivoj ${i}`, lastName: 'Hrachovec', gender: 'male' });
        await settle(PATCH_INTERVAL_MS);
        expect(sat.of('patch').length).toBe(before + 1);
        expect(Object.keys(treeOf(last(sat.of('patch'))!.json).persons)).toHaveLength(6);
    });

    it('where the work stands here (focus, default person, default view) is no change: the edit made meanwhile passes, and the main window keeps its own', async () => {
        const sat = await connect();
        const base = sat.of('tree')[0].revision;
        const zdislava = DataManager.getAllPersons()[0];
        // A click on a card here while the satellite edits.
        DataManager.setDefaultPerson(LAST_FOCUSED);
        DataManager.saveLastFocus(zdislava.id, 3, 2);
        DataManager.setDefaultView('last');
        await settle(PATCH_INTERVAL_MS);
        expect(registry.revision).toBe(base);

        const next = treeOf(sat.of('tree')[0].json);
        (next.persons[zdislava.id] as Person).birthPlace = 'Lhota';
        sat.bus.post({ type: 'edit', windowId: sat.id, editId: 'e9', treeId: TREE, baseRevision: base, json: JSON.stringify(next), label: 'editing Zdislava Okurková' });
        await settle();

        expect(last(sat.of('edit-result'))).toMatchObject({ editId: 'e9', ok: true, revision: base + 1 });
        expect(DataManager.getPerson(zdislava.id)!.birthPlace).toBe('Lhota');
        const data = DataManager.getData();
        expect([data.defaultPersonId, data.lastFocusPersonId, data.lastFocusDepthUp, data.lastFocusDepthDown, data.defaultView])
            .toEqual([LAST_FOCUSED, zdislava.id, 3, 2, 'last']);
    });
});

describe('the list of windows', () => {
    it('bye takes a window off; a window closed without a word goes within 2 s', async () => {
        const a = await connect();
        const b = await connect();
        const changes = vi.fn();
        registry.onChange(changes);
        a.bus.post({ type: 'bye', windowId: a.id });
        await settle();
        expect(registry.list().map(e => e.id)).toEqual([b.id]);
        opened.find(o => o.url.includes(b.id))!.win.closed = true;
        await settle(2000);
        expect(registry.size).toBe(0);
        expect(changes).toHaveBeenCalledTimes(2);
    });

    it('close: the reference closes the window; one without a reference is asked to close itself', async () => {
        const a = await connect();
        const foreign = listener(hub, 'foreign1');
        foreign.bus.post({ type: 'hello', windowId: 'foreign1', kind: 'table', treeId: TREE });
        await settle();
        registry.closeAll();
        await settle();
        expect(opened[0].win.closed).toBe(true);
        expect(foreign.of('close')).toHaveLength(1);
        expect(a.of('close')).toHaveLength(0);
        expect(registry.size).toBe(0);
    });

    it('focus: confirmed by the window within 400 ms, else false', async () => {
        const a = await connect();
        a.bus.on('focus-req', m => a.bus.post({ type: 'focused', to: m.from }));
        const ok = registry.focusWindow(a.id);
        await settle();
        await expect(ok).resolves.toBe(true);
        expect(opened[0].win.focus).toHaveBeenCalled();

        const b = await connect();
        const silent = registry.focusWindow(b.id);
        await settle(400);
        await expect(silent).resolves.toBe(false);
    });
});

describe('selection', () => {
    it('a selection from a satellite reaches the main view and is not sent back', async () => {
        const sat = await connect();
        registry.onSelect((personId) => registry.announceSelection(personId));   // the main view selects it, as a click would
        const seen = vi.fn();
        registry.onSelect(seen);
        sat.bus.post({ type: 'select', personId: 'p1', treeId: TREE, origin: sat.id });
        await settle();
        expect(seen).toHaveBeenCalledWith('p1', sat.id);
        expect(sat.of('select')).toHaveLength(0);

        registry.announceSelection('p2');
        await settle();
        expect(sat.of('select')).toEqual([expect.objectContaining({ personId: 'p2', origin: 'main-1', treeId: TREE })]);
        registry.announceSelection('p2');
        await settle();
        expect(sat.of('select')).toHaveLength(1);
    });
});

describe('links and research actions from other windows', () => {
    it('a satellite\'s person menu gets the research rows listed here, only that window; another tree\'s: none', async () => {
        const sat = listener(hub, 'sat-r');
        const other = listener(hub, 'bystander');
        const rows = [{ action: 'research-review', label: 'Review', external: true }];
        registry.setResearchMenuProvider((personId) => (personId === 'p1' ? rows : []));
        sat.bus.post({ type: 'research-menu-req', reqId: 'r1', personId: 'p1', treeId: TREE });
        sat.bus.post({ type: 'research-menu-req', reqId: 'r2', personId: 'p1', treeId: 'another-tree' as TreeId });
        await settle();
        expect(sat.of('research-menu')).toEqual([
            expect.objectContaining({ to: 'sat-r', reqId: 'r1', items: rows }),
            expect.objectContaining({ to: 'sat-r', reqId: 'r2', items: [] }),
        ]);
        expect(other.of('research-menu')).toHaveLength(0);
    });

    it('wait for their handler, then go to it once', async () => {
        const tab = listener(hub, 'tab2');
        tab.bus.post({ type: 'link', search: '?person=p7' });
        await settle();
        const handler = vi.fn();
        registry.setLinkHandler(handler);
        expect(handler).toHaveBeenCalledWith({ search: '?person=p7', files: undefined }, 'tab2');
        tab.bus.post({ type: 'link', search: '?live=x' });
        await settle();
        expect(handler).toHaveBeenCalledTimes(2);
    });
});
