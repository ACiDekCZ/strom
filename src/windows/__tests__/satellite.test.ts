/**
 * A satellite window's side (spec 079 §2, §3): its DataManager takes the tree
 * from the main window and never touches storage; an edit goes to the main
 * window on the revision it was made on; a patch replaces the copy, but waits
 * while an edit is on its way or a staged dialog is open; a refused edit drops
 * what waited behind it; undo is the main window's; live research makes the
 * copy read-only; "Follow selection" off sends and takes nothing; a main
 * window that went quiet and let its lock go counts as closed.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DataManager } from '../../data.js';
import { TreeManager } from '../../tree-manager.js';
import { StorageManager } from '../../storage.js';
import { AuditLogManager } from '../../audit-log.js';
import { UndoManager } from '../../undo.js';
import type { StromData, TreeId, Person, PersonId } from '../../types.js';
import { WindowBus, createMemoryHub, FOCUS_WAIT_MS, type WindowMessage, type WindowStatus } from '../window-bus.js';
import { SatelliteClient, followSelectionKey, MAIN_SILENCE_MS } from '../satellite.js';
import type { LocksLike } from '../window-role.js';

const TREE = 'sat-tree' as TreeId;
const SAT = 'ab12cd34';

function person(id: string, firstName: string): Person {
    return { id: id as PersonId, firstName, lastName: 'Hrachovec', gender: 'male', isPlaceholder: false, partnerships: [], parentIds: [], childIds: [] } as unknown as Person;
}

function treeJson(...names: [string, string][]): string {
    const data: StromData = { persons: {}, partnerships: {} } as StromData;
    for (const [id, n] of names) (data.persons as Record<string, Person>)[id] = person(id, n);
    return JSON.stringify(data);
}

function status(over: Partial<WindowStatus> = {}): WindowStatus {
    return { live: false, locked: false, readOnly: false, researchState: null, treeExists: true, treeId: TREE, treeName: 'Hrachovcovi', revision: 100, canUndo: true, canRedo: false, windows: [SAT], ...over };
}

function noLocks(): LocksLike {
    return {
        request: (_n, _o, cb) => Promise.resolve(cb(null)),
        query: async () => ({ held: [] }),
    };
}

let hub: ReturnType<typeof createMemoryHub>;
let main: WindowBus;
let got: WindowMessage[];
let sat: SatelliteClient;
let session: Map<string, string>;
const writes = {
    save: undefined as unknown as ReturnType<typeof vi.spyOn>,
    note: undefined as unknown as ReturnType<typeof vi.spyOn>,
    storeSet: undefined as unknown as ReturnType<typeof vi.spyOn>,
    storeTogether: undefined as unknown as ReturnType<typeof vi.spyOn>,
    storeDelete: undefined as unknown as ReturnType<typeof vi.spyOn>,
    undoPush: undefined as unknown as ReturnType<typeof vi.spyOn>,
    localSet: vi.fn(),
    idbOpen: vi.fn(),
};

const of = <T extends WindowMessage['type']>(t: T) => got.filter(m => m.type === t) as Extract<WindowMessage, { type: T }>[];

async function settle(ms = 0): Promise<void> {
    await hub.flush();
    await vi.advanceTimersByTimeAsync(ms);
    await hub.flush();
}

/** The main window answers the hello: status, then the whole tree. */
async function connect(json = treeJson(['p1', 'Bořivoj']), revision = 100): Promise<void> {
    sat.start();
    await settle();
    main.post({ type: 'status', ...status({ revision }) });
    main.post({ type: 'tree', to: SAT, treeId: TREE, name: 'Hrachovcovi', revision, json });
    await settle();
}

beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-12T10:00:00Z'));
    writes.save = vi.spyOn(TreeManager, 'saveTreeData').mockImplementation(() => {});
    writes.note = vi.spyOn(TreeManager, 'noteUserChange').mockImplementation(() => {});
    writes.storeSet = vi.spyOn(StorageManager, 'set').mockResolvedValue(undefined);
    writes.storeTogether = vi.spyOn(StorageManager, 'setTogether').mockResolvedValue(undefined);
    writes.storeDelete = vi.spyOn(StorageManager, 'delete').mockResolvedValue(undefined);
    writes.undoPush = vi.spyOn(UndoManager, 'push');
    writes.localSet = vi.fn();
    writes.idbOpen = vi.fn();
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: writes.localSet, removeItem: writes.localSet, clear: writes.localSet, key: () => null, length: 0 });
    vi.stubGlobal('indexedDB', { open: writes.idbOpen, deleteDatabase: writes.idbOpen });
    vi.spyOn(AuditLogManager, 'log').mockImplementation(() => {});
    const dm = DataManager as unknown as { data: StromData; currentTreeId: TreeId | null; viewMode: boolean; pendingBefore: StromData | null; liveTreeId: TreeId | null };
    dm.data = { persons: {}, partnerships: {} } as StromData;
    dm.currentTreeId = null;
    dm.viewMode = false;
    dm.pendingBefore = null;
    dm.liveTreeId = null;
    DataManager.rollbackEditSession();
    UndoManager.setActiveTree(null);

    hub = createMemoryHub();
    main = new WindowBus('main-1', hub.channel());
    got = [];
    main.onAny(m => got.push(m));
    session = new Map();
    sat = new SatelliteClient({ kind: 'table', treeId: TREE, windowId: SAT, newId: false }, {
        bus: new WindowBus(SAT, hub.channel()),
        storage: { getItem: k => session.get(k) ?? null, setItem: (k, v) => { session.set(k, v); } },
        locks: noLocks(),
        closeSelf: () => {},
        hasFocus: () => true,
        bounds: () => undefined,
    });
});

afterEach(() => {
    sat.stop();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

function expectNoStorage(): void {
    expect(writes.save).not.toHaveBeenCalled();
    expect(writes.note).not.toHaveBeenCalled();
    expect(writes.storeSet).not.toHaveBeenCalled();
    expect(writes.storeTogether).not.toHaveBeenCalled();
    expect(writes.storeDelete).not.toHaveBeenCalled();
    expect(writes.undoPush).not.toHaveBeenCalled();
    expect(writes.localSet).not.toHaveBeenCalled();
    expect(writes.idbOpen).not.toHaveBeenCalled();
}

describe('start', () => {
    it('says hello for its tree, takes the main window\'s tree into DataManager, and stores nothing', async () => {
        const trees = vi.fn();
        sat.on('tree', trees);
        await connect();
        expect(of('hello')).toEqual([expect.objectContaining({ windowId: SAT, kind: 'table', treeId: TREE })]);
        expect(sat.connection).toBe('connected');
        expect(sat.revision).toBe(100);
        expect(DataManager.getCurrentTreeId()).toBe(TREE);
        expect(DataManager.getPerson('p1' as PersonId)!.firstName).toBe('Bořivoj');
        expect(DataManager.isWindowCopy()).toBe(true);
        expect(trees).toHaveBeenCalledWith(expect.objectContaining({ treeId: TREE, name: 'Hrachovcovi', switchedFrom: null, afterConflict: false }));
        expectNoStorage();
    });

    it('the main window\'s person sent with a tree is there when the copy loads (its start reads it)', async () => {
        const seen: unknown[] = [];
        const load = DataManager.loadFromWindow.bind(DataManager);
        vi.spyOn(DataManager, 'loadFromWindow').mockImplementation((treeId, json) => { seen.push(sat.mainFocus); load(treeId, json); });
        sat.start();
        await settle();
        main.post({ type: 'status', ...status() });
        main.post({ type: 'tree', to: SAT, treeId: TREE, name: 'Hrachovcovi', revision: 100, json: treeJson(['p1', 'Bořivoj']), focus: { personId: 'p1', depthUp: 2, depthDown: 1 } });
        await settle();
        expect(seen).toEqual([{ personId: 'p1', depthUp: 2, depthDown: 1 }]);
        // A tree without one: none.
        main.post({ type: 'tree', to: SAT, treeId: 'sat-tree-2' as TreeId, name: 'Jiní', revision: 101, json: treeJson(['p2', 'Ctibor']) });
        await settle();
        expect(seen[1]).toBeNull();
    });
});

describe('edits', () => {
    it('an edit here goes to the main window with the revision it was made on, and nothing is stored here', async () => {
        await connect();
        const p = DataManager.createPerson({ firstName: 'Zdislava', lastName: 'Okurková', gender: 'female' });
        await settle();
        const edit = of('edit');
        expect(edit).toHaveLength(1);
        expect(edit[0]).toMatchObject({ windowId: SAT, treeId: TREE, baseRevision: 100 });
        expect(edit[0].label).toBe(DataManager.lastUndoDescription() ?? edit[0].label);
        expect(Object.keys((JSON.parse(edit[0].json) as StromData).persons)).toEqual(expect.arrayContaining(['p1', p.id]));
        expect(DataManager.getPerson(p.id)).toBeTruthy();   // the copy shows it at once
        expectNoStorage();

        main.post({ type: 'edit-result', to: SAT, editId: edit[0].editId, ok: true, revision: 101 });
        await settle();
        expect(sat.revision).toBe(101);
        expect(sat.pendingEdits).toBe(0);
    });

    it('edits wait for one another: the second goes on the revision the first one got', async () => {
        await connect();
        DataManager.createPerson({ firstName: 'Zdislava', lastName: 'Okurková', gender: 'female' });
        DataManager.createPerson({ firstName: 'Kvetoslav', lastName: 'Okurka', gender: 'male' });
        await settle();
        expect(of('edit')).toHaveLength(1);
        main.post({ type: 'edit-result', to: SAT, editId: of('edit')[0].editId, ok: true, revision: 101 });
        await settle();
        expect(of('edit')).toHaveLength(2);
        expect(of('edit')[1].baseRevision).toBe(101);
        expect(Object.keys((JSON.parse(of('edit')[1].json) as StromData).persons)).toHaveLength(3);
    });

    it('a refused edit drops what waited behind it; the fresh tree that follows is marked as after a conflict', async () => {
        await connect();
        const conflicts = vi.fn();
        const trees = vi.fn();
        sat.on('conflict', conflicts);
        sat.on('tree', trees);
        DataManager.createPerson({ firstName: 'Zdislava', lastName: 'Okurková', gender: 'female' });
        DataManager.createPerson({ firstName: 'Kvetoslav', lastName: 'Okurka', gender: 'male' });
        await settle();
        main.post({ type: 'edit-result', to: SAT, editId: of('edit')[0].editId, ok: false, revision: 102, reason: 'revision' });
        await settle();
        expect(conflicts).toHaveBeenCalledWith({ reason: 'revision', drafts: [] });
        expect(sat.pendingEdits).toBe(0);
        expect(of('edit')).toHaveLength(1);

        main.post({ type: 'tree', to: SAT, treeId: TREE, name: 'Hrachovcovi', revision: 102, json: treeJson(['p1', 'Bořivoj'], ['p2', 'Ctibor']) });
        await settle();
        expect(trees).toHaveBeenLastCalledWith(expect.objectContaining({ revision: 102, afterConflict: true }));
        expect(DataManager.getAllPersons().map(x => x.firstName).sort()).toEqual(['Bořivoj', 'Ctibor']);
    });

    it('a refused edit hands back the drafts of its editors, the sent one and those that waited', async () => {
        await connect();
        const conflicts = vi.fn();
        sat.on('conflict', conflicts);
        DataManager.runWithEditContext({ kind: 'cell', text: 'first' }, () => { DataManager.createPerson({ firstName: 'Zdislava', lastName: 'Okurková', gender: 'female' }); });
        DataManager.createPerson({ firstName: 'Bez', lastName: 'Konceptu', gender: 'male' });
        DataManager.runWithEditContext({ kind: 'cell', text: 'third' }, () => { DataManager.createPerson({ firstName: 'Kvetoslav', lastName: 'Okurka', gender: 'male' }); });
        await settle();
        main.post({ type: 'edit-result', to: SAT, editId: of('edit')[0].editId, ok: false, revision: 102, reason: 'revision' });
        await settle();
        expect(conflicts).toHaveBeenCalledWith({ reason: 'revision', drafts: [{ kind: 'cell', text: 'first' }, { kind: 'cell', text: 'third' }] });
    });

    it('undo and redo are the main window\'s', async () => {
        await connect();
        expect(DataManager.canUndo()).toBe(true);
        expect(DataManager.undo()).toBeNull();
        await settle();
        expect(of('undo')).toHaveLength(1);
        expectNoStorage();
    });
});

describe('patches', () => {
    it('a newer patch replaces the copy; an older one or another tree\'s is ignored', async () => {
        await connect();
        main.post({ type: 'patch', treeId: TREE, revision: 105, json: treeJson(['p1', 'Bořivoj Ctibor']) });
        await settle();
        expect(DataManager.getPerson('p1' as PersonId)!.firstName).toBe('Bořivoj Ctibor');
        expect(sat.revision).toBe(105);
        main.post({ type: 'patch', treeId: TREE, revision: 104, json: treeJson(['p1', 'old']) });
        main.post({ type: 'patch', treeId: 'other' as TreeId, revision: 200, json: treeJson(['p1', 'other']) });
        await settle();
        expect(DataManager.getPerson('p1' as PersonId)!.firstName).toBe('Bořivoj Ctibor');
        expectNoStorage();
    });

    it('waits while an edit of this window is on its way: the copy keeps showing the edit until the main window answers', async () => {
        await connect();
        const p = DataManager.createPerson({ firstName: 'Zdislava', lastName: 'Okurková', gender: 'female' });
        await settle();
        // The main window changed the tree before the edit reached it: its patch must not take the edit off the copy...
        main.post({ type: 'patch', treeId: TREE, revision: 101, json: treeJson(['p1', 'Bořivoj'], ['p9', 'Ctibor']) });
        await settle();
        expect(DataManager.getPerson(p.id)).toBeTruthy();
        expect(DataManager.getPerson('p9' as PersonId)).toBeFalsy();
        expect(sat.revision).toBe(100);
        // ...the edit is refused, and the main window's tree comes whole.
        main.post({ type: 'edit-result', to: SAT, editId: of('edit')[0].editId, ok: false, revision: 101, reason: 'revision' });
        main.post({ type: 'tree', to: SAT, treeId: TREE, name: 'Hrachovcovi', revision: 101, json: treeJson(['p1', 'Bořivoj'], ['p9', 'Ctibor']) });
        await settle();
        expect(sat.revision).toBe(101);
        expect(DataManager.getAllPersons().map(x => x.firstName).sort()).toEqual(['Bořivoj', 'Ctibor']);
    });

    it('a patch held for an edit the main window then saved is not applied over it', async () => {
        await connect();
        const p = DataManager.createPerson({ firstName: 'Zdislava', lastName: 'Okurková', gender: 'female' });
        await settle();
        main.post({ type: 'edit-result', to: SAT, editId: of('edit')[0].editId, ok: true, revision: 101 });
        main.post({ type: 'patch', treeId: TREE, revision: 101, json: treeJson(['p1', 'Bořivoj'], [p.id, 'Zdislava']) });
        main.post({ type: 'patch', treeId: TREE, revision: 102, json: treeJson(['p1', 'Bořivoj'], [p.id, 'Zdislava'], ['p9', 'Ctibor']) });
        await settle();
        expect(sat.revision).toBe(102);
        expect(DataManager.getAllPersons()).toHaveLength(3);
    });

    it('waits while a staged dialog is open; comes in when it is cancelled', async () => {
        await connect();
        expect(DataManager.beginEditSession()).toBe(true);
        main.post({ type: 'patch', treeId: TREE, revision: 101, json: treeJson(['p1', 'Bořivoj'], ['p9', 'Ctibor']) });
        await settle();
        expect(DataManager.getPerson('p9' as PersonId)).toBeFalsy();
        DataManager.rollbackEditSession();
        expect(DataManager.getPerson('p9' as PersonId)!.firstName).toBe('Ctibor');
        expect(sat.revision).toBe(101);
        expectNoStorage();
    });
});

describe('the main window\'s state', () => {
    it('a tree locked in the main window: the copy goes; after the unlock the tree comes again (no switch)', async () => {
        await connect(treeJson(['p1', 'Bořivoj'], ['p2', 'Ctibor']));
        const trees = vi.fn();
        sat.on('tree', trees);
        main.post({ type: 'status', ...status({ locked: true, readOnly: true }) });
        await settle();
        expect(DataManager.getAllPersons()).toHaveLength(0);
        expect(sat.hasTree).toBe(false);
        expect(sat.treeId).toBe(TREE);
        main.post({ type: 'tree', treeId: TREE, name: 'Hrachovcovi', revision: 101, json: treeJson(['p1', 'Bořivoj'], ['p2', 'Ctibor']) });
        await settle();
        expect(sat.hasTree).toBe(true);
        expect(DataManager.getAllPersons()).toHaveLength(2);
        expect(trees).toHaveBeenLastCalledWith(expect.objectContaining({ switchedFrom: null, afterConflict: false }));
        expectNoStorage();
    });

    it('a tree following a live research is read-only here', async () => {
        await connect();
        expect(DataManager.isTreeLocked()).toBe(false);
        main.post({ type: 'status', ...status({ live: true, readOnly: true }) });
        await settle();
        expect(sat.readOnly()).toBe(true);
        expect(DataManager.isTreeLocked()).toBe(true);
        expect(DataManager.canUndo()).toBe(false);
    });

    it('the tree renamed in the main window: the name follows its status', async () => {
        const renamed = vi.fn();
        sat.on('renamed', renamed);
        await connect();
        expect(sat.treeName).toBe('Hrachovcovi');
        main.post({ type: 'status', ...status({ treeName: 'Hrachovcovi z Pažitkova' }) });
        await settle();
        expect(sat.treeName).toBe('Hrachovcovi z Pažitkova');
        expect(renamed).toHaveBeenCalledWith('Hrachovcovi z Pažitkova');
        // Another tree's status does not rename this one.
        main.post({ type: 'status', ...status({ treeId: 'tree-other' as TreeId, treeName: 'Jiný' }) });
        await settle();
        expect(sat.treeName).toBe('Hrachovcovi z Pažitkova');
    });

    it('the main window quiet for 3 s and its lock free: closed, and nothing can be edited', async () => {
        const conn = vi.fn();
        sat.on('connection', conn);
        await connect();
        await settle(MAIN_SILENCE_MS + 1000);
        expect(sat.connection).toBe('main-closed');
        expect(conn).toHaveBeenLastCalledWith('main-closed');
        expect(DataManager.isTreeLocked()).toBe(true);
    });

    it('a quiet main window that still holds its lock is not closed', async () => {
        const held: LocksLike = { request: (_n, _o, cb) => Promise.resolve(cb(null)), query: async () => ({ held: [{ name: 'strom-main' }] }) };
        sat.stop();
        sat = new SatelliteClient({ kind: 'table', treeId: TREE, windowId: SAT, newId: false }, { bus: new WindowBus(SAT, hub.channel()), storage: null, locks: held, closeSelf: () => {}, hasFocus: () => true, bounds: () => undefined });
        await connect();
        await settle(MAIN_SILENCE_MS + 2000);
        expect(sat.connection).toBe('connected');
    });
});

describe('selection', () => {
    it('followed: sent with its origin, taken from others; off: neither', async () => {
        await connect();
        const selected = vi.fn();
        sat.on('select', selected);
        sat.announceSelection('p1');
        main.post({ type: 'select', personId: 'p2', treeId: TREE, origin: 'main-1' });
        await settle();
        expect(of('select')).toEqual([expect.objectContaining({ personId: 'p1', origin: SAT, treeId: TREE })]);
        expect(selected).toHaveBeenCalledWith({ personId: 'p2', origin: 'main-1' });

        const follow = vi.fn();
        sat.on('follow', follow);
        sat.followMode = 'off';
        expect(session.get(followSelectionKey(SAT))).toBe('off');
        // Said once, as it changes (the views drop the mark of the last choice taken).
        sat.followMode = 'off';
        expect(follow.mock.calls).toEqual([[false]]);
        sat.announceSelection('p3');
        main.post({ type: 'select', personId: 'p4', treeId: TREE, origin: 'main-1' });
        await settle();
        expect(of('select')).toHaveLength(1);
        expect(selected).toHaveBeenCalledTimes(1);
    });

    it('the mode (K2.1): the view\'s default until one is chosen, kept for the window; switch only where the centre can move', async () => {
        const modes = vi.fn();
        const on = vi.fn();
        sat.on('follow-mode', modes);
        sat.on('follow', on);
        expect(sat.kind).toBe('table');
        expect(sat.followMode).toBe('mark');
        sat.setKind('descendants');
        expect(sat.followMode).toBe('switch');
        sat.setKind('fan');
        sat.setKind('family');
        expect(modes.mock.calls).toEqual([['switch']]);
        // Chosen: kept across views; the view's default again drops the choice.
        sat.followMode = 'mark';
        expect(session.get(followSelectionKey(SAT))).toBe('mark');
        sat.setKind('descendants');
        expect(sat.followMode).toBe('mark');
        sat.followMode = 'switch';
        expect(session.get(followSelectionKey(SAT))).toBe('');
        // A stored switch in a view that cannot move its centre only marks.
        session.set(followSelectionKey(SAT), 'switch');
        sat.setKind('map');
        expect(sat.followMode).toBe('mark');
        expect(on).not.toHaveBeenCalled();
        // Before K2.1: '0' off, '1' the view's default.
        session.set(followSelectionKey(SAT), '0');
        expect(sat.followMode).toBe('off');
        expect(sat.followSelection).toBe(false);
        session.set(followSelectionKey(SAT), '1');
        sat.setKind('fan');
        expect(sat.followMode).toBe('switch');
        // A reload (another client of the same window) reads the choice.
        sat.followMode = 'off';
        const again = new SatelliteClient({ kind: 'fan', treeId: TREE, windowId: SAT, newId: false }, { bus: new WindowBus(SAT, hub.channel()), storage: { getItem: k => session.get(k) ?? null, setItem: () => {} }, locks: noLocks(), closeSelf: () => {}, hasFocus: () => true, bounds: () => undefined });
        expect(again.followMode).toBe('off');
    });

    it('two windows set to switch: a choice taken and made the centre is not sent on (no loop)', async () => {
        await connect();
        sat.setKind('descendants');
        const other = new SatelliteClient({ kind: 'family', treeId: TREE, windowId: 'ef56ab78', newId: false }, { bus: new WindowBus('ef56ab78', hub.channel()), storage: null, locks: noLocks(), closeSelf: () => {}, hasFocus: () => true, bounds: () => undefined });
        other.start();
        await settle();
        main.post({ type: 'tree', to: 'ef56ab78', treeId: TREE, name: 'Hrachovcovi', revision: 100, json: treeJson(['p1', 'Bořivoj']) });
        await settle();
        expect(sat.followMode).toBe('switch');
        expect(other.followMode).toBe('switch');
        // The new centre says itself as a click's would (strom:focus-changed → announceSelection).
        sat.on('select', ({ personId }) => sat.announceSelection(personId));
        other.on('select', ({ personId }) => other.announceSelection(personId));
        main.post({ type: 'select', personId: 'p2', treeId: TREE, origin: 'main-1' });
        await settle();
        expect(of('select')).toHaveLength(0);
        // A choice of one of them reaches the other, which does not send it back.
        sat.announceSelection('p3');
        await settle();
        expect(of('select').map(m => m.origin)).toEqual([SAT]);
        other.stop();
    });

    it('a selection taken from another window is not sent back', async () => {
        await connect();
        sat.on('select', ({ personId }) => sat.announceSelection(personId));   // the view selects it, as a click would
        main.post({ type: 'select', personId: 'p2', treeId: TREE, origin: 'main-1' });
        await settle();
        expect(of('select')).toHaveLength(0);
    });
});

describe('the person menu\'s research rows', () => {
    it('asked from the main window: its answer to this window, none when it is silent', async () => {
        await connect();
        const asked = sat.requestResearchMenu('p1', 300);
        await settle();
        const req = of('research-menu-req')[0];
        expect(req).toMatchObject({ personId: 'p1', treeId: TREE });
        main.post({ type: 'research-menu', to: SAT, reqId: req.reqId, items: [{ action: 'research-review', label: 'Review' }] });
        await settle();
        await expect(asked).resolves.toEqual([{ action: 'research-review', label: 'Review' }]);

        const silent = sat.requestResearchMenu('p1', 300);
        await settle(301);
        await expect(silent).resolves.toBeNull();
    });
});

describe('the Research overview in its own window (K3)', () => {
    it('the research\'s state from the main window reaches the view; another window\'s does not', async () => {
        await connect();
        const states: unknown[] = [];
        sat.on('research-state', (st) => states.push(st));
        main.post({ type: 'research-state', state: { v: 1, at: 5 } });
        new WindowBus('other-sat', hub.channel()).post({ type: 'research-state', state: { v: 1, at: 6 } });
        await settle();
        expect(states).toEqual([{ v: 1, at: 5 }]);
    });

    it('an action whose outcome it waits for: the answer to this window, null when the main window is silent', async () => {
        await connect();
        const sent = sat.researchActionResult('waiting-answer', { itemId: 'W1', text: 'Yes' }, 300);
        await settle();
        const req = of('research-action')[0];
        expect(req).toMatchObject({ action: 'waiting-answer', args: { itemId: 'W1', text: 'Yes' } });
        expect(req.reqId).toBeTruthy();
        main.post({ type: 'research-action-result', to: 'someone-else', reqId: req.reqId!, result: 'fail' });
        main.post({ type: 'research-action-result', to: SAT, reqId: req.reqId!, result: 'saved' });
        await settle();
        await expect(sent).resolves.toBe('saved');

        const silent = sat.researchActionResult('waiting-answer', { itemId: 'W1', text: 'Yes' }, 300);
        await settle(301);
        await expect(silent).resolves.toBeNull();
    });
});

describe('bring to front', () => {
    function satWithFocus(hasFocus: () => boolean): SatelliteClient {
        sat.stop();
        sat = new SatelliteClient({ kind: 'table', treeId: TREE, windowId: SAT, newId: false }, {
            bus: new WindowBus(SAT, hub.channel()), storage: null, locks: noLocks(), closeSelf: () => {}, hasFocus, bounds: () => undefined,
        });
        return sat;
    }

    it('not forward when the main window gives up: the window asks for attention (its title is marked)', async () => {
        const s = satWithFocus(() => false);
        await connect();
        const attention = vi.fn();
        s.on('attention', attention);
        main.post({ type: 'focus-req', to: SAT });
        await settle(FOCUS_WAIT_MS - 10);
        expect(attention).not.toHaveBeenCalled();
        await settle(20);
        expect(attention).toHaveBeenCalledTimes(1);
        expect(of('focused')).toHaveLength(0);
    });

    it('forward: it says so and asks for nothing', async () => {
        const s = satWithFocus(() => true);
        await connect();
        const attention = vi.fn();
        s.on('attention', attention);
        main.post({ type: 'focus-req', to: SAT });
        await settle(FOCUS_WAIT_MS + 50);
        expect(of('focused')).toHaveLength(1);
        expect(attention).not.toHaveBeenCalled();
    });
});
