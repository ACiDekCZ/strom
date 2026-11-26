/**
 * The main window's registry of satellite windows (spec 079 §0, §4): a
 * satellite's hello gets the starting state and the tree; an edit on the
 * present revision is saved as this window's own (an undo step with its
 * label) and goes to every window as a patch; an edit on an older revision is
 * refused and only that window gets the fresh tree; undo from a satellite;
 * the list follows hello, bye and closed windows; the selection does not loop.
 */

import { noteImageMeta } from '../../image-meta.js';
import { imagesInterned } from '../../image-intern.js';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DataManager } from '../../data.js';
import { TreeManager } from '../../tree-manager.js';
import { AuditLogManager } from '../../audit-log.js';
import { UndoManager } from '../../undo.js';
import { type StromData, type TreeId, type Person, type PersonId } from '../../types.js';
import { LAST_FOCUSED } from '../../model-values.js';
import { WindowBus, createMemoryHub, type WindowMessage } from '../window-bus.js';
import { WindowRegistry, dataManagerHost, PATCH_INTERVAL_MS, IMAGES_SETTLE_MAX_MS } from '../window-registry.js';
import { IMAGES_ARRIVED_EVENT } from '../../image-loads.js';
import { StorageManager } from '../../storage.js';

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
    sat.bus.post({ type: 'hello', takesData: true, windowId: id, kind: 'table', treeId: TREE });
    await settle();
    return { id, ...sat };
}

/** The tree a `tree`/`patch` message carries (an object the channel cloned, never one JSON string). */
function treeOf(data: unknown): StromData {
    expect(typeof data).toBe('object');
    return data as StromData;
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
        expect(Object.values(treeOf(tree[0].data).persons).map(p => (p as Person).firstName)).toEqual(['Zdislava']);
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
        sat.bus.post({ type: 'hello', takesData: true, windowId: sat.id, kind: 'table', treeId: TREE });
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
        sat.bus.post({ type: 'hello', takesData: true, windowId: 'sat-f5', kind: 'family', treeId: TREE });
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
        sat.bus.post({ type: 'hello', takesData: true, windowId: 'sat-f5', kind: 'family', treeId: 'reg-tree-2' as TreeId });
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
        const next = treeOf(sat.of('tree')[0].data);
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
        expect((treeOf(patch[0].data).persons[p.id] as Person).firstName).toBe('Zdislava Marie');

        // Undo here takes it back.
        DataManager.undo();
        expect(DataManager.getPerson(p.id)!.firstName).toBe('Zdislava');
    });

    it('on an older revision: refused, and only that window gets the fresh tree', async () => {
        const sat = await connect();
        const other = await connect();
        const base = sat.of('tree')[0].revision;
        DataManager.createPerson({ firstName: 'Bořivoj', lastName: 'Hrachovec', gender: 'male' });   // the main window changed meanwhile
        const stale = treeOf(sat.of('tree')[0].data);
        sat.bus.post({ type: 'edit', windowId: sat.id, editId: 'e2', treeId: TREE, baseRevision: base, json: JSON.stringify(stale), label: 'x' });
        const treesOther = other.of('tree').length;
        await settle();

        expect(sat.of('edit-result')).toEqual([expect.objectContaining({ ok: false, reason: 'revision', revision: base + 1 })]);
        const fresh = last(sat.of('tree'))!;
        expect(fresh.to).toBe(sat.id);
        expect(Object.keys(treeOf(fresh.data).persons)).toHaveLength(2);
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

    it('while following a research a satellite\'s change of the lists alone is taken: only the lists, a list\'s step undone (N2)', async () => {
        const sat = await connect();
        DataManager.setLiveTree(TREE);
        const copy = treeOf(last(sat.of('tree'))!.data);
        const list = { id: 'pl_1', name: 'Picked', dynamic: false, personIds: Object.keys(copy.persons), created: '2026-11-12T10:00:00.000Z', updated: '2026-11-12T10:00:00.000Z' };
        // Anything else in the copy (a person renamed) is not taken with the lists.
        const pid = Object.keys(copy.persons)[0];
        const edited = { ...copy, personLists: [list], persons: { ...copy.persons, [pid]: { ...copy.persons[pid as never], firstName: 'Jiná' } } };
        sat.bus.post({ type: 'edit', windowId: sat.id, editId: 'e4', treeId: TREE, baseRevision: registry.revision, json: JSON.stringify(edited), label: 'Add to list', listsOnly: true });
        await settle(PATCH_INTERVAL_MS);
        expect(last(sat.of('edit-result'))).toMatchObject({ ok: true });
        expect(DataManager.getPersonLists().map(l => l.name)).toContain('Picked');
        expect(DataManager.getAllPersons()[0].firstName).toBe('Zdislava');
        expect(last(sat.of('status'))).toMatchObject({ live: true, readOnly: true, listsOpen: true, undoOpen: true });
        // The same edit without the mark is refused, as any other.
        sat.bus.post({ type: 'edit', windowId: sat.id, editId: 'e5', treeId: TREE, baseRevision: registry.revision, json: JSON.stringify(edited), label: 'x' });
        await settle();
        expect(last(sat.of('edit-result'))).toMatchObject({ ok: false, reason: 'read-only' });
        // Undo from the satellite takes the list's step back.
        sat.bus.post({ type: 'undo' });
        await settle(PATCH_INTERVAL_MS);
        expect(DataManager.getPersonLists().map(l => l.name)).not.toContain('Picked');
        DataManager.setLiveTree(null);
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
        expect(Object.keys(treeOf(last(patch)!.data).persons)).toHaveLength(1);
        expect(last(sat.of('status'))).toMatchObject({ canUndo: false, canRedo: true });
    });

    it('a burst of saves makes one patch per half second', async () => {
        const sat = await connect();
        await settle(PATCH_INTERVAL_MS);
        const before = sat.of('patch').length;
        for (let i = 0; i < 5; i++) DataManager.createPerson({ firstName: `Bořivoj ${i}`, lastName: 'Hrachovec', gender: 'male' });
        await settle(PATCH_INTERVAL_MS);
        expect(sat.of('patch').length).toBe(before + 1);
        expect(Object.keys(treeOf(last(sat.of('patch'))!.data).persons)).toHaveLength(6);
    });

    it('no window holds the tree: saves copy nothing; a window saying hello then gets the whole tree, later saves a patch — never as one JSON string', async () => {
        const stringified = vi.spyOn(DataManager, 'storedDataJson');
        const json = vi.spyOn(DataManager, 'storedWindowData');
        for (let i = 0; i < 5; i++) {
            DataManager.createPerson({ firstName: `Bořivoj ${i}`, lastName: 'Hrachovec', gender: 'male' });
            await settle(PATCH_INTERVAL_MS);
        }
        await settle(3000);
        // The revision still follows every change (a satellite's edit is checked against it).
        expect(registry.revision).toBeGreaterThan(Date.now() - 60_000);
        expect(json).not.toHaveBeenCalled();

        const sat = await connect();
        expect(json).toHaveBeenCalledTimes(1);
        expect(Object.keys(treeOf(sat.of('tree')[0].data).persons)).toHaveLength(6);
        expect(sat.of('tree')[0].revision).toBe(registry.revision);
        DataManager.createPerson({ firstName: 'Kunhuta', lastName: 'Hrachovcová', gender: 'female' });
        await settle(PATCH_INTERVAL_MS);
        expect(sat.of('patch')).toHaveLength(1);
        expect(Object.keys(treeOf(sat.of('patch')[0].data).persons)).toHaveLength(7);
        expect(sat.of('tree')).toHaveLength(1);
        expect([...sat.of('tree'), ...sat.of('patch')].some(m => 'json' in m)).toBe(false);
        expect(stringified).not.toHaveBeenCalled();

        // The last window went: nothing copied again.
        sat.bus.post({ type: 'bye', windowId: sat.id });
        await settle();
        json.mockClear();
        DataManager.createPerson({ firstName: 'Ctibor', lastName: 'Hrachovec', gender: 'male' });
        await settle(PATCH_INTERVAL_MS);
        expect(json).not.toHaveBeenCalled();
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

        const next = treeOf(sat.of('tree')[0].data);
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
        foreign.bus.post({ type: 'hello', takesData: true, windowId: 'foreign1', kind: 'table', treeId: TREE });
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

describe('the windows\' own following of the agent (spec 097 §7)', () => {
    it('a status without any window following says no agents', async () => {
        const a = await connect();
        expect(last(a.of('status'))?.agents).toBeUndefined();
    });

    it('a window\'s state from its hello and its view messages, in the list (not as a change of it)', async () => {
        const a = await connect();
        expect(registry.list()[0].agent).toBeUndefined();
        const changes = vi.fn();
        registry.onChange(changes);
        a.bus.post({ type: 'view', windowId: a.id, kind: 'table', agent: 'detached' });
        await settle();
        expect(registry.list()[0]).toMatchObject({ id: a.id, kind: 'table', agent: 'detached' });
        expect(changes).not.toHaveBeenCalled();
        // The status says it at once, not only with the next heartbeat (a main window closing meanwhile).
        expect(last(a.of('status'))?.agents).toEqual({ [a.id]: 'detached' });
        a.bus.post({ type: 'hello', takesData: true, windowId: a.id, kind: 'table', treeId: TREE, agent: 'paused' });
        await settle();
        expect(registry.list()[0].agent).toBe('paused');
        // The status names it for every window (the order of taking over).
        expect(last(a.of('status'))?.agents).toEqual({ [a.id]: 'paused' });
        a.bus.post({ type: 'view', windowId: a.id, kind: 'family', agent: null });
        await settle();
        expect(registry.list()[0]).toMatchObject({ kind: 'family' });
        expect(registry.list()[0].agent).toBeUndefined();
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
        expect(seen).toHaveBeenCalledWith('p1', sat.id, { intent: 'mark', seq: null });
        expect(sat.of('select')).toHaveLength(0);

        registry.announceSelection('p2');
        await settle();
        expect(sat.of('select')).toEqual([expect.objectContaining({ personId: 'p2', origin: 'main-1', treeId: TREE })]);
        registry.announceSelection('p2');
        await settle();
        expect(sat.of('select')).toHaveLength(1);
    });

    it('a choice sent with focus (spec 110): its intent and number reach the main view; the end of a window\'s sending is said', async () => {
        const sat = await connect();
        const seen = vi.fn();
        const ended = vi.fn();
        registry.onSelect(seen);
        registry.onSendEnded(ended);
        sat.bus.post({ type: 'select', personId: 'p1', treeId: TREE, origin: sat.id, intent: 'focus', seq: 7 });
        await settle();
        expect(seen).toHaveBeenCalledWith('p1', sat.id, { intent: 'focus', seq: 7 });
        sat.bus.post({ type: 'send-mode', windowId: sat.id, mode: 'focus' });
        await settle();
        expect(ended).not.toHaveBeenCalled();
        sat.bus.post({ type: 'send-mode', windowId: sat.id, mode: 'mark' });
        await settle();
        expect(ended.mock.calls).toEqual([[sat.id]]);
        sat.bus.post({ type: 'bye', windowId: sat.id });
        await settle();
        expect(ended.mock.calls).toEqual([[sat.id], [sat.id]]);
    });
});

describe('the main window following the agent (spec 110 §4)', () => {
    it('its status says so to the other windows', async () => {
        registry.stop();
        let following = false;
        registry = new WindowRegistry({
            bus: new WindowBus('main-1', hub.channel()),
            host: dataManagerHost({ treeName: () => treeName, treeExists: () => true, focusSelf: () => {}, hasFocus: () => true, followingAgent: () => following }),
            openWindow: () => fakeWindow() as unknown as Window,
        });
        registry.start();
        const sat = await connect();
        expect(last(sat.of('status'))?.followingAgent).toBeUndefined();
        following = true;
        await settle(1100);
        expect(last(sat.of('status'))?.followingAgent).toBe(true);
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

    it('a satellite\'s research action runs for this tree; one for another tree (switched meanwhile) does not run and has no outcome', async () => {
        const sat = listener(hub, 'sat-a');
        const handler = vi.fn(() => 'done');
        registry.setResearchActionHandler(handler);
        sat.bus.post({ type: 'research-action', action: 'verify-person', args: { personId: 'p1' }, reqId: 'a1', treeId: TREE });
        sat.bus.post({ type: 'research-action', action: 'verify-person', args: { personId: 'p1' }, reqId: 'a2', treeId: 'another-tree' as TreeId });
        sat.bus.post({ type: 'research-action', action: 'places-queue', args: { places: ['Brodek'] }, treeId: 'another-tree' as TreeId });
        await settle();
        expect(handler).toHaveBeenCalledTimes(1);
        expect(handler).toHaveBeenCalledWith('verify-person', { personId: 'p1' }, 'sat-a');
        expect(sat.of('research-action-result')).toEqual([
            expect.objectContaining({ to: 'sat-a', reqId: 'a1', result: 'done' }),
            expect.objectContaining({ to: 'sat-a', reqId: 'a2', result: null }),
        ]);
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

describe('the fan\'s family-line colours (spec 114 §3)', () => {
    it('go to every window after a change; a fan window saying hello or switching to the fan gets the last ones; empty forgets them', async () => {
        const table = await connect();
        const mem: Array<[string, string]> = [['rod-a', 'PS0'], ['rod-b', 'MS1']];
        if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('strom:fan-rod-colors', { detail: mem }));
        else registry.postFanRodColors(mem);
        await settle();
        expect(table.of('fan-rod-colors')).toEqual([expect.objectContaining({ treeId: TREE, memory: mem })]);
        // A fan window opened later: the memory with its hello, to it alone.
        const id = registry.openSatellite('fan')!;
        const fan = listener(hub, id);
        fan.bus.post({ type: 'hello', takesData: true, windowId: id, kind: 'fan', treeId: TREE });
        await settle();
        expect(fan.of('fan-rod-colors')).toEqual([expect.objectContaining({ to: id, treeId: TREE, memory: mem })]);
        expect(table.of('fan-rod-colors')).toHaveLength(1);
        // The table window switches to the fan: it gets them too.
        table.bus.post({ type: 'view', windowId: table.id, kind: 'fan' });
        await settle();
        expect(last(table.of('fan-rod-colors'))).toMatchObject({ to: table.id, memory: mem });
        // Forgotten (the fan closed here): an empty memory to all, nothing for the next window.
        registry.postFanRodColors([]);
        await settle();
        expect(last(fan.of('fan-rod-colors'))).toMatchObject({ memory: [] });
        const id2 = registry.openSatellite('fan')!;
        const fan2 = listener(hub, id2);
        fan2.bus.post({ type: 'hello', takesData: true, windowId: id2, kind: 'fan', treeId: TREE });
        await settle();
        expect(fan2.of('fan-rod-colors')).toHaveLength(0);
    });
});

describe('images that came after the tree (spec 116, I6)', () => {
    it('reach the satellites as a patch, like a change of the data: nothing stored, no undo step', async () => {
        registry.stop();
        vi.stubGlobal('window', new EventTarget());
        try {
            registry = new WindowRegistry({
                bus: new WindowBus('main-img', hub.channel()),
                host: dataManagerHost({ treeName: () => treeName, treeExists: () => true, focusSelf: () => {}, hasFocus: () => true }),
                openWindow: () => fakeWindow() as unknown as Window,
                geometry: () => null,
            });
            registry.start();
            const sat = await connect();
            await settle(PATCH_INTERVAL_MS);
            const before = sat.of('patch').length;
            saveSpy.mockClear();
            const id = DataManager.getAllPersons()[0].id;
            const url = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2Q==';
            DataManager.applyImageArrivals(TREE, d => { d.persons[id].photo = url; });
            window.dispatchEvent(new CustomEvent(IMAGES_ARRIVED_EVENT, { detail: { treeId: TREE, seq: 1, keys: [`person:${id}:photo`] } }));
            await settle(PATCH_INTERVAL_MS);
            expect(sat.of('patch').length).toBe(before + 1);
            expect(treeOf(last(sat.of('patch'))!.data).persons[id].photo).toBe(url);
            expect(saveSpy).not.toHaveBeenCalled();
            expect(UndoManager.canUndo()).toBe(false);
        } finally {
            registry.stop();
            vi.unstubAllGlobals();
        }
    });
});

describe('pooled images to the satellites (spec 135, D8)', () => {
    const photo = 'data:image/jpeg;base64,' + 'Q'.repeat(4000);
    const plainId = 'p:' + 'ab'.repeat(20);
    const lockedId = 'e:' + 'ef'.repeat(20);
    const meta = { len: photo.length, head: 'data:image/jpeg;base64,', bytes: 3000, w: 10, h: 20, token: 'img:t', mtok: 'm' };

    function withPool(): ReturnType<typeof vi.spyOn> {
        noteImageMeta({ [plainId]: meta });
        return vi.spyOn(StorageManager, 'getMany').mockImplementation(async (_store: string, keys: string[]) =>
            new Map(keys.map(k => [k, k === plainId || k === lockedId ? { text: photo } : null])) as never);
    }

    function setRef(id: string): PersonId {
        const pid = DataManager.getAllPersons()[0].id;
        (DataManager.getPerson(pid) as Person).photo = '\u0000sm:' + id;
        return pid;
    }

    async function hello(kind: 'overview' | 'table', poolRefs: boolean) {
        const id = registry.openSatellite(kind)!;
        const sat = listener(hub, id);
        sat.bus.post({ type: 'hello', takesData: true, windowId: id, kind, treeId: TREE, ...(poolRefs ? { poolRefs: true as const } : {}) });
        await settle();
        return { id, ...sat };
    }

    it('the tree and every patch carry the references as they are (an encrypted pool\'s too), with their catalog entries', async () => {
        const getMany = withPool();
        const pid = setRef(plainId);
        const other = DataManager.createPerson({ firstName: 'Kunhuta', lastName: 'Okurková', gender: 'female' });
        (DataManager.getPerson(other.id) as Person).photo = '\u0000sm:' + lockedId;
        await settle(PATCH_INTERVAL_MS);
        const a = await hello('overview', true);
        const b = await hello('table', true);
        const tree = a.of('tree')[0];
        expect(treeOf(tree.data).persons[pid].photo).toBe('\u0000sm:' + plainId);
        expect(treeOf(tree.data).persons[other.id].photo).toBe('\u0000sm:' + lockedId);
        expect(tree.imageMeta).toEqual({ [plainId]: meta });
        expect(treeOf(b.of('tree')[0].data).persons[pid].photo).toBe('\u0000sm:' + plainId);
        DataManager.createPerson({ firstName: 'Ludmila', lastName: 'Okurková', gender: 'female' });
        await settle(PATCH_INTERVAL_MS);
        const patch = last(a.of('patch'))!;
        expect(treeOf(patch.data).persons[pid].photo).toBe('\u0000sm:' + plainId);
        expect(patch.imageMeta).toEqual({ [plainId]: meta });
        expect(patch.images).toBeUndefined();
        expect(JSON.stringify(patch)).not.toContain('QQQQ');
        // Nothing read from the pool for them.
        expect(getMany).not.toHaveBeenCalled();
    });

    it('a window that reads no references (a 3.32 beta before the pool) gets every image whole, and so do all while it is open', async () => {
        withPool();
        const pid = setRef(plainId);
        DataManager.createPerson({ firstName: 'Kunhuta', lastName: 'Okurková', gender: 'female' });
        await settle(PATCH_INTERVAL_MS);
        const reads = await hello('overview', true);
        const plain = await hello('table', false);
        await vi.waitFor(() => expect(plain.of('tree')).toHaveLength(1));
        expect(treeOf(plain.of('tree')[0].data).persons[pid].photo).toBe(photo);
        DataManager.createPerson({ firstName: 'Ludmila', lastName: 'Okurková', gender: 'female' });
        await settle(PATCH_INTERVAL_MS);
        await vi.waitFor(() => expect(reads.of('patch').length).toBeGreaterThan(0));
        expect(treeOf(last(reads.of('patch'))!.data).persons[pid].photo).toBe(photo);
        // The tree here keeps the reference.
        expect(DataManager.getPerson(pid)!.photo).toBe('\u0000sm:' + plainId);
    });

    it('a window that does not reach this one\'s pool asks for images: their Blobs, read here (also an encrypted pool\'s)', async () => {
        vi.spyOn(StorageManager, 'getMany').mockImplementation(async (_store: string, keys: string[]) =>
            new Map(keys.map(k => [k, k === plainId ? { head: 'data:image/png;base64,', bytes: new Uint8Array([1, 2, 3, 4]).buffer } : null])) as never);
        const sat = await hello('overview', true);
        sat.bus.post({ type: 'images-req', windowId: sat.id, reqId: 'r1', ids: [plainId, lockedId, 'not-an-id'] });
        await settle();
        await vi.waitFor(() => expect(sat.of('images')).toHaveLength(1));
        const answer = sat.of('images')[0];
        expect(answer).toMatchObject({ to: sat.id, reqId: 'r1' });
        expect(Object.keys(answer.blobs).sort()).toEqual([plainId, lockedId].sort());
        expect(answer.blobs[plainId]?.size).toBe(4);
        expect(answer.blobs[lockedId]).toBeNull();
    });

    it('a new image (not in the pool yet) goes whole; while a save under way pools it the patch waits for its reference, at most a while', async () => {
        let settling = false;
        registry.stop();
        registry = new WindowRegistry({
            bus: new WindowBus('main-settle', hub.channel()),
            host: dataManagerHost({ treeName: () => treeName, treeExists: () => true, focusSelf: () => {}, hasFocus: () => true, imagesSettling: () => settling }),
            openWindow: () => fakeWindow() as unknown as Window,
            geometry: () => null,
        });
        registry.start();
        const sat = await hello('overview', true);
        const pid = DataManager.getAllPersons()[0].id;
        settling = true;
        DataManager.updatePerson(pid, { photo });
        await settle(PATCH_INTERVAL_MS * 3);
        expect(sat.of('patch')).toHaveLength(0);
        // The save put it into the pool: the tree holds its reference now.
        withPool();
        (DataManager.getPerson(pid) as Person).photo = '\u0000sm:' + plainId;
        settling = false;
        await settle(PATCH_INTERVAL_MS);
        expect(sat.of('patch')).toHaveLength(1);
        expect(treeOf(sat.of('patch')[0].data).persons[pid].photo).toBe('\u0000sm:' + plainId);
        // A save that does not settle: the image goes whole after IMAGES_SETTLE_MAX_MS.
        settling = true;
        DataManager.updatePerson(pid, { photo });
        await settle(IMAGES_SETTLE_MAX_MS - PATCH_INTERVAL_MS);
        expect(sat.of('patch')).toHaveLength(1);
        await settle(PATCH_INTERVAL_MS * 2);
        expect(sat.of('patch')).toHaveLength(2);
        expect(treeOf(sat.of('patch')[1].data).persons[pid].photo).toBe(photo);
    });

    it('new images sent whole and pooled afterwards: the same revision once more, with their references', async () => {
        const sat = await hello('overview', true);
        const pid = DataManager.getAllPersons()[0].id;
        DataManager.updatePerson(pid, { photo });
        await settle(PATCH_INTERVAL_MS);
        const sent = last(sat.of('patch'))!;
        expect(treeOf(sent.data).persons[pid].photo).toBe(photo);
        // The save pools it (image-intern.ts): the tree in memory holds its reference.
        withPool();
        imagesInterned(TREE, new Map([[photo, '\u0000sm:' + plainId]]));
        await settle(PATCH_INTERVAL_MS);
        const again = last(sat.of('patch'))!;
        expect(again).not.toBe(sent);
        expect(again).toMatchObject({ revision: sent.revision, images: true });
        expect(treeOf(again.data).persons[pid].photo).toBe('\u0000sm:' + plainId);
        // A change after it: a plain patch of the next revision.
        DataManager.createPerson({ firstName: 'Ludmila', lastName: 'Okurková', gender: 'female' });
        await settle(PATCH_INTERVAL_MS);
        expect(last(sat.of('patch'))!.revision).toBeGreaterThan(sent.revision);
        expect(last(sat.of('patch'))!.images).toBeUndefined();
    });

    it('an edit of a satellite with a new image: the patch held back for the save carries the reference, marked for the window that holds that revision', async () => {
        let settling = false;
        registry.stop();
        registry = new WindowRegistry({
            bus: new WindowBus('main-settle2', hub.channel()),
            host: dataManagerHost({ treeName: () => treeName, treeExists: () => true, focusSelf: () => {}, hasFocus: () => true, imagesSettling: () => settling }),
            openWindow: () => fakeWindow() as unknown as Window,
            geometry: () => null,
        });
        registry.start();
        const sat = await hello('overview', true);
        const pid = DataManager.getAllPersons()[0].id;
        const copy = structuredClone(DataManager.getData());
        copy.persons[pid].photo = photo;
        settling = true;
        sat.bus.post({ type: 'edit', windowId: sat.id, editId: 'e1', treeId: TREE, baseRevision: registry.revision, json: JSON.stringify(copy), label: 'Photo' });
        await settle(PATCH_INTERVAL_MS * 2);
        const result = sat.of('edit-result')[0];
        expect(result).toMatchObject({ ok: true });
        expect(sat.of('patch')).toHaveLength(0);
        withPool();
        settling = false;
        imagesInterned(TREE, new Map([[photo, '\u0000sm:' + plainId]]));
        await settle(PATCH_INTERVAL_MS);
        const patch = last(sat.of('patch'))!;
        expect(patch).toMatchObject({ revision: result.revision, images: true });
        expect(treeOf(patch.data).persons[pid].photo).toBe('\u0000sm:' + plainId);
    });
});

describe('a satellite of an older version (3.31 and before) among the windows (1122)', () => {
    it('gets the tree as one JSON string with its images, and so do the others while it is open; then data again', async () => {
        const pid = DataManager.getAllPersons()[0].id;
        const photo = 'data:image/jpeg;base64,' + 'Q'.repeat(4000);
        DataManager.updatePerson(pid, { photo });
        await settle(PATCH_INTERVAL_MS);
        const fresh = await connect();
        const id = registry.openSatellite('overview')!;
        const old = listener(hub, id);
        old.bus.post({ type: 'hello', windowId: id, kind: 'overview', treeId: TREE });
        await settle();
        const tree = old.of('tree')[0] as unknown as { json?: string; data?: unknown };
        expect(tree.data).toBeUndefined();
        expect((JSON.parse(tree.json!) as StromData).persons[pid].photo).toBe(photo);
        DataManager.createPerson({ firstName: 'Kunhuta', lastName: 'Okurková', gender: 'female' });
        await settle(PATCH_INTERVAL_MS);
        const patch = last(fresh.of('patch'))! as unknown as { json?: string; data?: unknown };
        expect(patch.data).toBeUndefined();
        expect(Object.keys((JSON.parse(patch.json!) as StromData).persons)).toHaveLength(2);
        old.bus.post({ type: 'bye', windowId: id });
        await settle();
        DataManager.createPerson({ firstName: 'Ludmila', lastName: 'Okurková', gender: 'female' });
        await settle(PATCH_INTERVAL_MS);
        expect(treeOf(last(fresh.of('patch'))!.data).persons[pid].photo).toBe(photo);
    });

    it('a pooled image in the tree reaches it whole, read from the pool; the messages after the tree keep their order (135)', async () => {
        const pid = DataManager.getAllPersons()[0].id;
        const bytes = new Uint8Array(3000).map((_, i) => (i * 13) & 0xFF);
        const head = 'data:image/jpeg;base64,';
        const photo = head + Buffer.from(bytes).toString('base64');
        const poolId = 'p:' + 'c4'.repeat(20);
        const getMany = vi.spyOn(StorageManager, 'getMany').mockImplementation(async (_store: string, keys: string[]) =>
            new Map(keys.map(k => [k, k === poolId ? { head, bytes: bytes.slice().buffer } : null])) as never);
        // In memory as a tree read from storage holds it once images stay in the pool (135 D6).
        (DataManager as unknown as { data: StromData }).data.persons[pid].photo = '\u0000sm:' + poolId;
        const id = registry.openSatellite('overview')!;
        const old = listener(hub, id);
        old.bus.post({ type: 'hello', windowId: id, kind: 'overview', treeId: TREE });
        await settle();
        await vi.waitFor(() => expect(old.of('tree')).toHaveLength(1));
        const tree = old.of('tree')[0] as unknown as { json?: string };
        expect(tree.json).not.toContain('sm:p:');
        expect((JSON.parse(tree.json!) as StromData).persons[pid].photo).toBe(photo);
        expect(getMany).toHaveBeenCalled();
        // The status the registry sent after the tree comes after it.
        const order = old.got.filter(m => m.type === 'tree' || m.type === 'status').map(m => m.type);
        expect(order.indexOf('tree')).toBeLessThan(order.lastIndexOf('status'));
        // The tree in memory keeps its reference.
        expect(DataManager.getData().persons[pid].photo).toBe('\u0000sm:' + poolId);
    });
});
