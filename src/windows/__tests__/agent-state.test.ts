/**
 * The agent's state across the app's windows (spec 097 K1.3, K3.1): the
 * main window sends only the sections that changed since its last revision,
 * the whole state to a window after its hello or its ask, nothing while no
 * window draws from it, at most one post per tick after hints; the status
 * carries the revision. A satellite's mirror takes a delta on its revision,
 * asks for the whole state when it missed one (a delta on another revision,
 * a status naming another revision), and starts anew with another main
 * window. No bridge address or token crosses. A satellite reads the main
 * window's metadata of its tree without storing or listing it.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DataManager } from '../../data.js';
import { TreeManager } from '../../tree-manager.js';
import type { StromData, TreeId, TreeMetadata } from '../../types.js';
import { WindowBus, createMemoryHub, type WindowMessage, type WindowStatus } from '../window-bus.js';
import { WindowRegistry, dataManagerHost } from '../window-registry.js';
import {
    AgentMirrorStore, AgentStateSender, agentStateSafe, AGENT_STATE_VERSION, type AgentSections,
} from '../agent-state.js';
import { startAgentMain, AGENT_THROTTLE_MS, type AgentMain } from '../agent-main.js';
import { AgentMirror, ASK_GAP_MS, RECHECK_MS, type AgentMirrorClient } from '../agent-mirror.js';
import { bridgeSecrets, overviewSessionData } from '../overview-window.js';
import type { LiveSession } from '../../ui/research-ui.js';

const TREE = 'am-tree' as TreeId;
const BASE = 'http://127.0.0.1:5990/0123456789abcdef0123456789abcdef';
const TOKEN = '0123456789abcdef0123456789abcdef';

function sections(over: Partial<AgentSections> = {}): AgentSections {
    return {
        link: { treeId: TREE, meta: { id: TREE, name: 'Okurkovi', research: { id: 'R1', name: 'Výzkum' } } },
        live: null,
        work: { live: true, followed: true, waiting: [], working: [{ who: 'agent', person: 'P0003', task: 'Křest' }], queue: [], done: [] },
        cards: [['P0003', { agent: 'Křest' }]],
        status: null,
        places: null,
        follow: { on: true, view: null },
        ...over,
    };
}

describe('what crosses', () => {
    it('no bridge address or token: a session, a status and a stored base lose every string carrying them', () => {
        const session = {
            researchId: 'R1', treeId: TREE, name: 'Výzkum', head: 'h1', ended: false, working: [{ who: 'agent', person: 'P0003' }],
            bridge: { base: BASE, status: `${BASE}/status`, ged: `${BASE}/tree.ged`, events: `${BASE}/events`, log: `${BASE}/log` },
            note: `see ${BASE}/log`, waitingView: { fresh: new Set(['w1', `${TOKEN}`]), tagged: new Map([['w1', TOKEN]]) },
        } as unknown as LiveSession;
        const secrets = bridgeSecrets(BASE);
        const safe = agentStateSafe(sections({
            live: overviewSessionData(session, secrets) as unknown as Record<string, unknown>,
            status: { researchId: 'R1', status: { head: 'h1', url: BASE, token: TOKEN, features: ['origin'] } },
        }), secrets);
        const all = JSON.stringify(safe, (_k, v: unknown) => v instanceof Map ? [...v] : v instanceof Set ? [...v] : v);
        expect(all).not.toContain(TOKEN);
        expect(all).not.toContain('127.0.0.1:5990');
        // What is no secret stays.
        expect((safe.live as { head: string }).head).toBe('h1');
        expect((safe.status!.status as { features: string[] }).features).toEqual(['origin']);
        expect((safe.live as { waitingView: { fresh: Set<string> } }).waitingView.fresh).toEqual(new Set(['w1']));
    });
});

describe('AgentStateSender / AgentMirrorStore', () => {
    it('the first state is every section; the same again is nothing; a change is that section alone on the last revision', () => {
        const sender = new AgentStateSender(1000);
        const first = sender.next(sections())!;
        expect(first).toMatchObject({ v: AGENT_STATE_VERSION, rev: 1001, base: 1000 });
        expect(Object.keys(first.sections).sort()).toEqual(['cards', 'follow', 'link', 'live', 'places', 'status', 'work']);
        expect(sender.next(sections())).toBeNull();
        const second = sender.next(sections({ follow: { on: false, view: null } }))!;
        expect(second).toMatchObject({ rev: 1002, base: 1001, sections: { follow: { on: false, view: null } } });
        expect(Object.keys(second.sections)).toEqual(['follow']);
        // A Map's or Set's change inside a section is a change.
        const a = sender.next(sections({ follow: { on: false, view: null }, live: { fresh: new Set(['a']) } }))!;
        expect(Object.keys(a.sections)).toEqual(['live']);
        const b = sender.next(sections({ follow: { on: false, view: null }, live: { fresh: new Set(['a', 'b']) } }))!;
        expect(Object.keys(b.sections)).toEqual(['live']);
    });

    it('a large section with its own stamp is not compared by its content', () => {
        const sender = new AgentStateSender(0);
        const places = { rev: 'p1', places: [['P0003', [{ role: 'line' }]]] as [string, unknown[]][], lines: [], branches: [] };
        sender.next(sections({ places }), { places: 'p1' });
        // Another object, the same stamp: not sent.
        expect(sender.next(sections({ places: { ...places } }), { places: 'p1' })).toBeNull();
        expect(Object.keys(sender.next(sections({ places }), { places: 'p2' })!.sections)).toEqual(['places']);
    });

    it('the mirror takes the whole state, then deltas on its revision; a gap asks for the whole state; a repeat is ignored', () => {
        const sender = new AgentStateSender(10);
        const store = new AgentMirrorStore();
        const d1 = sender.next(sections())!;
        // A delta before any whole state: on no revision of the mirror.
        expect(store.apply(d1).kind).toBe('need-full');
        expect(store.apply(sender.full())).toEqual({ kind: 'applied', changed: ['link', 'live', 'work', 'cards', 'status', 'places', 'follow'] });
        expect(store.rev).toBe(11);
        expect(store.apply(sender.full()).kind).toBe('ignored');
        const d2 = sender.next(sections({ cards: [] }))!;
        expect(store.apply(d2)).toEqual({ kind: 'applied', changed: ['cards'] });
        expect(store.get('cards')).toEqual([]);
        expect(store.apply(d2).kind).toBe('ignored');
        sender.next(sections({ cards: [['P1', {}]] }));   // lost
        const d4 = sender.next(sections({ cards: [['P2', {}]] }))!;
        expect(store.apply(d4).kind).toBe('need-full');
        expect(store.get('cards')).toEqual([]);
        expect(store.apply({ v: 99, rev: 1, base: null, sections: {} }).kind).toBe('ignored');
        expect(store.reset()).toHaveLength(7);
        expect(store.rev).toBeNull();
    });
});

/** A satellite's client for the mirror: what it hears, what it asks. */
function fakeClient() {
    const handlers = new Map<string, Set<(p: unknown) => void>>();
    const client = {
        mainWindowId: 'main-1' as string | null,
        asked: 0,
        on(event: string, cb: (p: unknown) => void) {
            const set = handlers.get(event) ?? new Set();
            handlers.set(event, set);
            set.add(cb);
            return () => { set.delete(cb); };
        },
        requestAgentState() { client.asked++; },
        emit(event: string, payload: unknown) { for (const cb of handlers.get(event) ?? []) cb(payload); },
    };
    return client;
}

const status = (agentRev: number | null): WindowStatus => ({
    live: true, locked: false, readOnly: true, researchState: null, treeExists: true, treeId: TREE, treeName: 'Okurkovi',
    revision: 1, canUndo: false, canRedo: false, windows: ['sat-1'], agentRev,
});

describe('AgentMirror', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-11-16T10:00:00Z'));
    });
    afterEach(() => { vi.useRealTimers(); });

    it('reads the sections, keeps the derived objects while they do not change, and names what changed', () => {
        const client = fakeClient();
        const mirror = new AgentMirror(client as unknown as AgentMirrorClient).start();
        const changed: string[][] = [];
        mirror.onChange(c => changed.push([...c]));
        const sender = new AgentStateSender(0);
        const session = { researchId: 'R1', treeId: TREE, ended: false, lostSince: 0, working: [{ who: 'agent', person: 'P0003' }] };
        const places = { rev: 'p1', places: [['P0003', [{ role: 'line' }]]] as [string, unknown[]][], lines: [], branches: [] };
        sender.next(sections({ live: session, places }));
        client.emit('agent-state', sender.full());
        expect(mirror.treeId()).toBe(TREE);
        expect(mirror.cards().get('P0003')).toEqual({ agent: 'Křest' });
        const s = mirror.session()!;
        expect(s.bridge.base).toBe('');
        expect(mirror.session()).toBe(s);
        expect(mirror.places()!.places.get('P0003')).toEqual([{ role: 'line' }]);
        expect(mirror.places()).toBe(mirror.places());
        expect(mirror.live()).toEqual({ treeId: TREE, researchId: 'R1', lostSince: 0, ended: false, working: [{ who: 'agent', person: 'P0003' }] });
        expect(mirror.follow()).toEqual({ on: true, view: null });
        client.emit('agent-state', sender.next(sections({ live: session, places, follow: { on: false, view: 'map' } })));
        expect(mirror.session()).toBe(s);
        expect(changed).toEqual([['link', 'live', 'work', 'cards', 'status', 'places', 'follow'], ['follow']]);
        expect(client.asked).toBe(0);
    });

    it('a missed delta asks for the whole state at once; a status on another revision asks after a while, not again at once', async () => {
        const client = fakeClient();
        const mirror = new AgentMirror(client as unknown as AgentMirrorClient).start();
        const sender = new AgentStateSender(0);
        sender.next(sections());
        client.emit('agent-state', sender.full());
        client.emit('status', status(sender.rev));
        await vi.advanceTimersByTimeAsync(RECHECK_MS + 10);
        expect(client.asked).toBe(0);
        sender.next(sections({ cards: [] }));   // lost on the way
        client.emit('agent-state', sender.next(sections({ cards: [['P9', {}]] })));
        expect(client.asked).toBe(1);
        // The status names the newer revision: asked again only after ASK_GAP_MS.
        client.emit('status', status(sender.rev));
        await vi.advanceTimersByTimeAsync(RECHECK_MS + 10);
        expect(client.asked).toBe(1);
        await vi.advanceTimersByTimeAsync(ASK_GAP_MS);
        client.emit('status', status(sender.rev));
        await vi.advanceTimersByTimeAsync(RECHECK_MS + 10);
        expect(client.asked).toBe(2);
        // The whole state comes: the mirror stands where the status says.
        client.emit('agent-state', sender.full());
        expect(mirror.rev).toBe(sender.rev);
        expect(mirror.cards().has('P9')).toBe(true);
    });

    it('another main window: what the earlier one said is forgotten', () => {
        const client = fakeClient();
        const mirror = new AgentMirror(client as unknown as AgentMirrorClient).start();
        const sender = new AgentStateSender(0);
        sender.next(sections());
        client.emit('status', status(null));
        client.emit('agent-state', sender.full());
        expect(mirror.treeId()).toBe(TREE);
        client.mainWindowId = 'main-2';
        client.emit('status', status(null));
        expect(mirror.treeId()).toBeNull();
        expect(mirror.rev).toBeNull();
    });
});

const last = <T>(a: readonly T[]): T => a[a.length - 1];

function listener(hub: ReturnType<typeof createMemoryHub>, id: string) {
    const bus = new WindowBus(id, hub.channel());
    const got: WindowMessage[] = [];
    bus.onAny(m => got.push(m));
    return { bus, got, of: <T extends WindowMessage['type']>(t: T) => got.filter(m => m.type === t) as Extract<WindowMessage, { type: T }>[] };
}

describe('startAgentMain', () => {
    let hub: ReturnType<typeof createMemoryHub>;
    let registry: WindowRegistry;
    let main: AgentMain;
    let built = 0;
    let state: AgentSections;

    async function settle(ms = 0): Promise<void> {
        await hub.flush();
        await vi.advanceTimersByTimeAsync(ms);
        await hub.flush();
    }

    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-11-16T10:00:00Z'));
        vi.spyOn(TreeManager, 'saveTreeData').mockImplementation(() => {});
        const dm = DataManager as unknown as { data: StromData; currentTreeId: TreeId | null; viewMode: boolean };
        dm.data = { persons: {}, partnerships: {} };
        dm.currentTreeId = TREE;
        dm.viewMode = false;
        hub = createMemoryHub();
        registry = new WindowRegistry({
            bus: new WindowBus('main-1', hub.channel()),
            host: dataManagerHost({ treeName: () => 'Okurkovi', treeExists: () => true, focusSelf: () => {}, hasFocus: () => true }),
            openWindow: () => ({ closed: false, focus: () => {}, close: () => {} }) as unknown as Window,
            geometry: () => null,
        });
        registry.start();
        built = 0;
        state = sections();
        main = startAgentMain(registry, { sections: () => { built++; return { sections: state }; } });
    });

    afterEach(() => {
        main.stop();
        registry.stop();
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    async function connect(kind: 'table' | 'overview') {
        const id = registry.openSatellite(kind)!;
        const sat = listener(hub, id);
        sat.bus.post({ type: 'hello', windowId: id, kind, treeId: TREE });
        await settle();
        return { id, ...sat };
    }

    it('nothing is built while no window draws from it (an overview window has its own state)', async () => {
        await connect('overview');
        main.changed();
        await settle(3000);
        expect(built).toBe(0);
    });

    it('the whole state to a window after its hello and its ask; the status carries the revision', async () => {
        const by = listener(hub, 'bystander');
        const sat = await connect('table');
        const full = last(sat.of('agent-state'));
        expect(full.to).toBe(sat.id);
        expect(full.state).toMatchObject({ base: null, rev: main.rev() });
        await settle();
        expect(last(by.of('status')).agentRev).toBe(main.rev());
        // Its ask (a revision missed): the whole state again, to it alone.
        const before = sat.of('agent-state').length;
        sat.bus.post({ type: 'agent-state-req', windowId: sat.id });
        await settle();
        expect(sat.of('agent-state')).toHaveLength(before + 1);
        expect(last(sat.of('agent-state')).to).toBe(sat.id);
    });

    it('hints: one build and one delta per tick, only the changed section, to every window', async () => {
        const sat = await connect('table');
        const start = built;
        const posts = sat.of('agent-state').length;
        state = sections({ cards: [] });
        for (let i = 0; i < 20; i++) main.changed();
        await settle(AGENT_THROTTLE_MS + 10);
        expect(built - start).toBe(1);
        const delta = sat.of('agent-state').slice(posts);
        expect(delta).toHaveLength(1);
        expect(delta[0].to).toBeUndefined();
        expect(Object.keys((delta[0].state as { sections: object }).sections)).toEqual(['cards']);
        // Nothing changed: the tick's look sends nothing.
        await settle(1000);
        expect(sat.of('agent-state').slice(posts)).toHaveLength(1);
    });
});

describe('TreeManager: the main window\'s metadata in a satellite', () => {
    afterEach(() => TreeManager.setWindowTreeMetadata(null));

    it('read by its id, never in the list of trees, gone when cleared', () => {
        const meta = { id: 'sat-tree', name: 'Okurkovi', research: { id: 'R1' } } as unknown as TreeMetadata;
        TreeManager.setWindowTreeMetadata(meta);
        expect(TreeManager.getTreeMetadata('sat-tree' as TreeId)).toBe(meta);
        expect(TreeManager.getTreeMetadata('other' as TreeId)).toBeNull();
        expect(TreeManager.getTrees().some(t => t.id === 'sat-tree')).toBe(false);
        TreeManager.setWindowTreeMetadata(null);
        expect(TreeManager.getTreeMetadata('sat-tree' as TreeId)).toBeNull();
    });
});
