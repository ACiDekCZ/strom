/**
 * Another tab while the main window is open (spec 079 §5): its link goes to
 * the main window exactly once, when the main window is heard, and leaves the
 * tab's address; the main window opens it with the handlers of its own start
 * (the research's requests, the tree, the search, the person); "Switch there"
 * waits FOCUS_WAIT_MS for the main window's focus; "Open as another window"
 * makes the tab a satellite of the main window's tree.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { TreeId } from '../../types.js';
import { WindowBus, createMemoryHub, FOCUS_WAIT_MS } from '../window-bus.js';
import { WindowRegistry, type MainWindowHost } from '../window-registry.js';
import { SecondTab, MAIN_STATUS_WAIT_MS } from '../second-tab.js';
import { openForwardedLink, type LinkOpenerDeps, type ForwardedLink } from '../window-link.js';
import type { SatelliteParams } from '../window-role.js';

const TREE = 'tree-main' as TreeId;

let hub: ReturnType<typeof createMemoryHub>;
let focused: boolean;
let focusCalls: number;

function fakeHost(): MainWindowHost {
    return {
        treeId: () => TREE,
        treeName: () => 'Okurkovi',
        treeExists: () => true,
        storedJson: () => '{"persons":{},"partnerships":{}}',
        stateStamp: () => [TREE],
        applyEdit: () => true,
        busy: () => false,
        undo: () => {},
        redo: () => {},
        canUndo: () => false,
        canRedo: () => false,
        live: () => false,
        locked: () => false,
        readOnly: () => false,
        researchState: () => null,
        onSaved: () => () => {},
        focusSelf: () => { focusCalls++; },
        hasFocus: () => focused,
    };
}

/** What the main window's handlers were asked to do. */
function recordingDeps(): LinkOpenerDeps & { calls: string[] } {
    const calls: string[] = [];
    let current = { id: 'tree-main', researchId: null as string | null };
    return {
        calls,
        currentTree: () => current,
        pickTree: (params) => {
            const slug = params.get('tree');
            return slug ? { id: slug, researchId: null } : null;
        },
        switchTree: async (id) => { calls.push(`switch ${id}`); current = { id, researchId: null }; },
        externalRequest: (params) => {
            const keys = ['send', 'live', 'import-url', 'adopt'].filter(k => params.has(k));
            if (!keys.length) return false;
            calls.push(`external ${keys.map(k => `${k}=${params.get(k)}`).join(' ')}`);
            return true;
        },
        search: (q) => { calls.push(`search ${q}`); },
        deepLink: async (link, matches) => { calls.push(`deep ${link.kind}${link.kind === 'person' ? ` ${link.ref}` : ''} ${matches}`); },
        openFile: (h) => { calls.push(`file ${(h as { name: string }).name}`); },
    };
}

async function settle(ms = 0): Promise<void> {
    await hub.flush();
    await vi.advanceTimersByTimeAsync(ms);
    await hub.flush();
}

let registry: WindowRegistry;
let deps: ReturnType<typeof recordingDeps>;
let links: ForwardedLink[];

function startMain(): void {
    registry = new WindowRegistry({ bus: new WindowBus('main-1', hub.channel()), host: fakeHost(), openWindow: () => null });
    registry.start();
    registry.setLinkHandler((link) => { links.push(link); void openForwardedLink(link, deps); });
}

function tab(search: string, extra: { replaced?: string[]; became?: SatelliteParams[] } = {}): SecondTab {
    const t = new SecondTab({
        bus: new WindowBus('tab-1', hub.channel()),
        search,
        href: () => `https://stromapp.info/run/${search}`,
        replaceUrl: (url) => { extra.replaced?.push(url); },
        becomeSatellite: (p) => { extra.became?.push(p); },
    });
    t.start();
    return t;
}

beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-12T10:00:00Z'));
    hub = createMemoryHub();
    focused = true;
    focusCalls = 0;
    deps = recordingDeps();
    links = [];
});

afterEach(() => {
    registry?.stop();
    vi.useRealTimers();
});

describe('a link in the second tab', () => {
    it('reaches the main window once, after it is heard, and leaves the tab\'s address', async () => {
        const replaced: string[] = [];
        const t = tab('?tree=tree-main&person=P0012&debug=1', { replaced });
        // The address is clean at once (a reload sends nothing again).
        expect(replaced).toEqual(['https://stromapp.info/run/?debug=1']);
        await settle();
        // No main window heard yet: nothing sent.
        expect(t.forwarded).toBe(0);

        startMain();
        await settle();
        expect(t.forwarded).toBe(1);
        expect(links).toEqual([{ search: '?person=P0012&tree=tree-main' }]);
        expect(deps.calls).toEqual(['deep person P0012 true']);

        // Heartbeats later: still once.
        await settle(3000);
        expect(links).toHaveLength(1);
        expect(deps.calls).toEqual(['deep person P0012 true']);
        t.stop();
    });

    it('?live= / ?send= / ?import-url= go to the research\'s handler once, with their parameters, and switch no tree', async () => {
        startMain();
        for (const [search, call] of [
            ['?live=http%3A%2F%2F127.0.0.1%3A5996&tree=other', 'external live=http://127.0.0.1:5996'],
            ['?send=http%3A%2F%2F127.0.0.1%3A5997', 'external send=http://127.0.0.1:5997'],
            ['?import-url=http%3A%2F%2F127.0.0.1%3A5998%2Ftree.json', 'external import-url=http://127.0.0.1:5998/tree.json'],
        ] as const) {
            deps.calls.length = 0;
            const t = tab(search);
            await settle(1000);
            await settle(2000);
            expect(deps.calls).toEqual([call]);
            t.stop();
        }
    });

    it('a person of another tree: that tree opens first, then the person', async () => {
        startMain();
        const t = tab('?tree=tree-b&person=p_1');
        await settle(1000);
        expect(deps.calls).toEqual(['switch tree-b', 'deep person p_1 true']);
        t.stop();
    });

    it('?search= searches in the main window; a plain address or a tree alone passes nothing on', async () => {
        startMain();
        const t1 = tab('?search=Okurka');
        await settle(1000);
        expect(deps.calls).toEqual(['search Okurka']);
        t1.stop();

        deps.calls.length = 0;
        const t2 = tab('?tree=tree-b');
        const t3 = tab('');
        await settle(2000);
        expect(t2.forwarded + t3.forwarded).toBe(0);
        expect(deps.calls).toEqual([]);
    });

    it('a launch of the installed app reaching the tab goes on once, with its files', async () => {
        startMain();
        const t = tab('');
        await settle(1000);
        t.forwardLink({ files: [{ name: 'rod.ged' }] });
        await settle(2000);
        expect(deps.calls).toEqual(['file rod.ged']);
        expect(t.forwarded).toBe(1);
        t.stop();
    });
});

describe('"Switch there"', () => {
    it('the main window is asked to the front and says it has the focus', async () => {
        startMain();
        const t = tab('');
        await settle(1000);
        const result = t.switchThere();
        await settle();
        await expect(result).resolves.toBe(true);
        expect(focusCalls).toBe(1);
        t.stop();
    });

    it('no focus within FOCUS_WAIT_MS: false (the tab says where Strom is)', async () => {
        focused = false;
        startMain();
        const t = tab('');
        await settle(1000);
        let result: boolean | null = null;
        void t.switchThere().then((r) => { result = r; });
        await settle(FOCUS_WAIT_MS - 50);
        expect(result).toBe(null);
        await settle(100);
        expect(result).toBe(false);
        t.stop();
    });

    it('no main window heard: false after the wait', async () => {
        const t = tab('');
        let result: boolean | null = null;
        void t.switchThere().then((r) => { result = r; });
        await settle(MAIN_STATUS_WAIT_MS + 10);
        expect(result).toBe(false);
        t.stop();
    });
});

describe('"Open as another window"', () => {
    it('the tab becomes a satellite of the main window\'s tree, its address says so', async () => {
        startMain();
        const replaced: string[] = [];
        const became: SatelliteParams[] = [];
        const t = tab('?debug=1', { replaced, became });
        await settle(1000);
        const params = await t.openAsWindow('table');
        expect(params).toMatchObject({ kind: 'table', treeId: TREE, newId: false });
        expect(params.windowId).toMatch(/^[0-9a-f]{8}$/);
        expect(became).toEqual([params]);
        expect(replaced).toEqual([`https://stromapp.info/run/?okno=table&tree=${TREE}&w=${params.windowId}`]);
    });
});
