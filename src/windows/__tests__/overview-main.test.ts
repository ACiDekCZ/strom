/**
 * The main window's wiring of the Research overview in a window of its own
 * (spec 079 K3, 6g): the research's state goes to the overview window after a
 * change (one post per tick) and at once after its hello (a reload too);
 * nothing is built or posted while no overview window is open; its actions
 * are checked and run here, an outcome asked for goes back to that window
 * only; the UI hears when the first overview window opens and the last one
 * closes, and ⤢ / the menu bring it to the front.
 */

import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';
import { DataManager } from '../../data.js';
import { TreeManager } from '../../tree-manager.js';
import type { StromData, TreeId } from '../../types.js';
import { WindowBus, createMemoryHub, type WindowMessage } from '../window-bus.js';
import { WindowRegistry, dataManagerHost } from '../window-registry.js';
import { startOverviewMain, type OverviewMain } from '../overview-main.js';
import { focusOverviewWindow, overviewChanged, overviewInWindow, type OverviewAction } from '../overview-window.js';

const TREE = 'ov-tree' as TreeId;

function listener(hub: ReturnType<typeof createMemoryHub>, id: string) {
    const bus = new WindowBus(id, hub.channel());
    const got: WindowMessage[] = [];
    bus.onAny(m => got.push(m));
    return { bus, got, of: <T extends WindowMessage['type']>(t: T) => got.filter(m => m.type === t) as Extract<WindowMessage, { type: T }>[] };
}

let hub: ReturnType<typeof createMemoryHub>;
let registry: WindowRegistry;
let main: OverviewMain;
let state: Mock<() => unknown>;
let run: Mock<(a: OverviewAction) => unknown>;
let openChanged: Mock<(open: boolean) => void>;
let focused: string[];

async function settle(ms = 0): Promise<void> {
    await hub.flush();
    await vi.advanceTimersByTimeAsync(ms);
    await hub.flush();
}

beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-13T10:00:00Z'));
    vi.spyOn(TreeManager, 'saveTreeData').mockImplementation(() => {});
    const dm = DataManager as unknown as { data: StromData; currentTreeId: TreeId | null; viewMode: boolean };
    dm.data = { persons: {}, partnerships: {} };
    dm.currentTreeId = TREE;
    dm.viewMode = false;
    hub = createMemoryHub();
    focused = [];
    registry = new WindowRegistry({
        bus: new WindowBus('main-1', hub.channel()),
        host: dataManagerHost({ treeName: () => 'Okurkovi', treeExists: () => true, focusSelf: () => {}, hasFocus: () => true }),
        openWindow: () => ({ closed: false, focus: () => {}, close: () => {} }) as unknown as Window,
        geometry: () => null,
    });
    registry.start();
    const realFocus = registry.focusWindow.bind(registry);
    vi.spyOn(registry, 'focusWindow').mockImplementation((id) => { focused.push(id); return realFocus(id); });
    let n = 0;
    state = vi.fn(() => ({ v: 1, n: ++n }));
    run = vi.fn((a: OverviewAction) => (a.action === 'waiting-answer' ? Promise.resolve('saved') : true));
    openChanged = vi.fn();
    main = startOverviewMain(registry, { state, run, openChanged });
});

afterEach(() => {
    main.stop();
    registry.stop();
    vi.useRealTimers();
    vi.restoreAllMocks();
});

/** Open an overview window from the main window and let it say hello. */
async function connectOverview() {
    const id = registry.openSatellite('overview')!;
    const sat = listener(hub, id);
    sat.bus.post({ type: 'hello', windowId: id, kind: 'overview', treeId: TREE });
    await settle();
    return { id, ...sat };
}

describe('research-state', () => {
    it('nothing is built or posted while no overview window is open (a Table window does not count)', async () => {
        const by = listener(hub, 'bystander');
        const table = registry.openSatellite('table')!;
        listener(hub, table).bus.post({ type: 'hello', windowId: table, kind: 'table', treeId: TREE });
        await settle();
        overviewChanged();
        main.changed();
        await settle();
        expect(state).not.toHaveBeenCalled();
        expect(by.of('research-state')).toHaveLength(0);
        expect(overviewInWindow()).toBe(false);
    });

    it('posted at once after the overview window\'s hello, and again after its reload', async () => {
        const sat = await connectOverview();
        expect(sat.of('research-state')).toEqual([expect.objectContaining({ from: 'main-1', state: { v: 1, n: 1 } })]);
        // F5 in the overview window: the same id says hello again.
        sat.bus.post({ type: 'hello', windowId: sat.id, kind: 'overview', treeId: TREE });
        await settle();
        expect(sat.of('research-state')).toHaveLength(2);
    });

    it('after a change: one post per tick, however many changes it had', async () => {
        const sat = await connectOverview();
        state.mockClear();
        overviewChanged();
        overviewChanged();
        main.changed();
        await settle();
        expect(state).toHaveBeenCalledTimes(1);
        expect(sat.of('research-state')).toHaveLength(2);
        overviewChanged();
        await settle();
        expect(sat.of('research-state')).toHaveLength(3);
    });

    it('the window closed: nothing posted any more', async () => {
        const sat = await connectOverview();
        sat.bus.post({ type: 'bye', windowId: sat.id });
        await settle();
        state.mockClear();
        overviewChanged();
        await settle();
        expect(state).not.toHaveBeenCalled();
    });
});

describe('6g: the main window hears of the overview window', () => {
    it('opened: open() and the UI told once; closed: told again', async () => {
        expect(overviewInWindow()).toBe(false);
        const sat = await connectOverview();
        expect(overviewInWindow()).toBe(true);
        expect(openChanged.mock.calls).toEqual([[true]]);
        sat.bus.post({ type: 'bye', windowId: sat.id });
        await settle();
        expect(overviewInWindow()).toBe(false);
        expect(openChanged.mock.calls).toEqual([[true], [false]]);
    });

    it('opened from here: open at once, before its hello (the overview here closes in the same click)', () => {
        registry.openSatellite('overview');
        expect(overviewInWindow()).toBe(true);
        expect(openChanged).toHaveBeenCalledWith(true);
    });

    it('⤢ and Research › Research overview: focus-req to that window', async () => {
        const sat = await connectOverview();
        focusOverviewWindow();
        await settle();
        expect(focused).toEqual([sat.id]);
        expect(sat.of('focus-req')).toEqual([expect.objectContaining({ to: sat.id })]);
    });
});

describe('research-action from the overview window', () => {
    it('a checked action runs here', async () => {
        const sat = await connectOverview();
        registry.setResearchActionHandler((action, args) => main.handle(action, args).result);
        sat.bus.post({ type: 'research-action', action: 'show-person', args: { personId: 'P1' } });
        sat.bus.post({ type: 'research-action', action: 'follow-tree', args: { on: false } });
        await settle();
        expect(run.mock.calls.map(c => c[0])).toEqual([
            { action: 'show-person', args: { personId: 'P1' } },
            { action: 'follow-tree', args: { on: false } },
        ]);
    });

    it('an unknown action, or arguments it does not take: not run', async () => {
        const sat = await connectOverview();
        registry.setResearchActionHandler((action, args) => main.handle(action, args).result);
        sat.bus.post({ type: 'research-action', action: 'eval', args: {} });
        sat.bus.post({ type: 'research-action', action: 'show-person', args: { personId: 7 } });
        sat.bus.post({ type: 'research-action', action: 'research-link', args: { link: 'live', params: { url: { x: 1 } } } });
        await settle();
        expect(run).not.toHaveBeenCalled();
    });

    it('an outcome asked for (reqId) goes back to that window only', async () => {
        const sat = await connectOverview();
        const other = listener(hub, 'bystander');
        registry.setResearchActionHandler((action, args) => main.handle(action, args).result);
        sat.bus.post({ type: 'research-action', action: 'waiting-answer', args: { itemId: 'W1', text: 'Yes' }, reqId: 'r1' });
        await settle();
        expect(sat.of('research-action-result')).toEqual([expect.objectContaining({ to: sat.id, reqId: 'r1', result: 'saved' })]);
        expect(other.of('research-action-result')).toHaveLength(0);
    });
});
