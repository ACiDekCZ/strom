/**
 * A research link launched in a window of its own (a tree's satellite, no
 * bridge there): the main window builds it again for its tree and hands it
 * over (`research-link`, relayed), so its bridge proves it and the satellite's
 * button never says the false "did not open". The main window stays where it
 * is (a terminal opens, nothing of its own). With the main window closed, and
 * in the main window itself, the link goes as before. Invented data.
 */

import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';

const busy = vi.hoisted(() => ({ calls: [] as { url: string; opts: Record<string, unknown>; deps: { handOver(link: string): void; ask(id: string): Promise<unknown> } }[] }));
vi.mock('../ui/research-open-busy.js', async (importOriginal) => {
    const real = await importOriginal<typeof import('../ui/research-open-busy.js')>();
    return {
        ...real,
        openResearchBusy: vi.fn(async (_el: unknown, url: string, opts: Record<string, unknown>, deps: { handOver(link: string): void; ask(id: string): Promise<unknown> }) => {
            busy.calls.push({ url, opts, deps });
            return 'opened';
        }),
    };
});

import { setBridgelessWindow } from '../research-device.js';
import { researchLinkActionOf, researchSchemeUrl, type ResearchLinkAction, type ResearchLinkParams } from '../research-link.js';
import { setSatResearchForward, type SatResearchForward } from '../windows/window-sat-research.js';
import { readOverviewAction } from '../windows/overview-window.js';

const RID = '0b4c7a52-1c1f-4d7e-9a53-2f4a3c1e8b10';

type Ui = {
    launchResearchLink(url: string, kind?: 'terminal' | 'agent' | 'version', el?: HTMLElement | null): Promise<string>;
    handOverResearchLink: ReturnType<typeof vi.fn>;
    askResearchBridge: ReturnType<typeof vi.fn>;
    awaitResearchVersion: ReturnType<typeof vi.fn>;
};

describe('a research link launched in a satellite window', () => {
    let methods: Record<string, unknown>;

    beforeAll(async () => {
        ({ researchUiMethods: methods } = await import('../ui/research-ui.js') as unknown as { researchUiMethods: Record<string, unknown> });
    }, 60000);

    afterEach(() => {
        busy.calls = [];
        setBridgelessWindow(false);
        setSatResearchForward(null);
    });

    function ui(): Ui {
        return {
            launchResearchLink: methods.launchResearchLink,
            handOverResearchLink: vi.fn(),
            askResearchBridge: vi.fn(async () => null),
            awaitResearchVersion: vi.fn(),
        } as unknown as Ui;
    }

    function forward(open = true) {
        const f = { mainOpen: vi.fn(() => open), run: vi.fn(), ask: vi.fn(async () => null) };
        setSatResearchForward(f as SatResearchForward);
        return f;
    }

    it('the person page\'s research link: the main window builds and hands it over, relayed, without coming forward', async () => {
        setBridgelessWindow(true);
        const f = forward();
        const u = ui();
        const url = `strom-research://research?tree=${RID}&person=P0012&direction=ancestors`;
        expect(await u.launchResearchLink(url, 'terminal')).toBe('opened');
        expect(busy.calls).toHaveLength(1);
        expect(busy.calls[0].opts).toMatchObject({ relayed: true, agent: false });
        // Nothing handed over here, no bridge asked for its proof here.
        expect(await busy.calls[0].deps.ask(RID)).toBeNull();
        busy.calls[0].deps.handOver(url);
        expect(u.handOverResearchLink).not.toHaveBeenCalled();
        expect(f.run).toHaveBeenCalledWith('research-link', { link: 'research', params: { person: 'P0012', direction: 'ancestors' } }, false);
        // What the main window takes (its reading of the action) and builds again for its tree.
        const read = readOverviewAction('research-link', f.run.mock.calls[0][1]);
        expect(read).not.toBeNull();
        const args = (read as { args: { link: ResearchLinkAction; params: Record<string, unknown> } }).args;
        expect(researchSchemeUrl(args.link, { tree: RID, ...args.params } as ResearchLinkParams)).toBe(url);
    });

    it('an agent\'s link goes as the agent\'s (the main window says it starts the agent)', async () => {
        setBridgelessWindow(true);
        const f = forward();
        const u = ui();
        await u.launchResearchLink(`strom-research://chat?tree=${RID}&person=P0012`, 'agent');
        expect(busy.calls[0].opts).toMatchObject({ relayed: true, agent: true });
        busy.calls[0].deps.handOver('');
        expect(f.run).toHaveBeenCalledWith('research-link', { link: 'chat', params: { person: 'P0012' }, kind: 'agent' }, false);
    });

    it('with the main window closed: the link goes from here as before', async () => {
        setBridgelessWindow(true);
        const f = forward(false);
        const u = ui();
        const url = `strom-research://experiment?tree=${RID}&name=history&do=on`;
        await u.launchResearchLink(url, 'terminal');
        expect(busy.calls[0].opts.relayed).toBeUndefined();
        busy.calls[0].deps.handOver(url);
        expect(u.handOverResearchLink).toHaveBeenCalledWith(url, undefined);
        expect(f.run).not.toHaveBeenCalled();
    });

    it('in the main window: the link goes from here, its bridge proving it', async () => {
        const f = forward();
        const u = ui();
        const url = `strom-research://experiment?tree=${RID}&name=history&do=on`;
        await u.launchResearchLink(url, 'terminal');
        expect(busy.calls[0].opts.relayed).toBeUndefined();
        await busy.calls[0].deps.ask(RID);
        expect(u.askResearchBridge).toHaveBeenCalled();
        expect(f.run).not.toHaveBeenCalled();
    });

    it('a link the main window cannot build again is not relayed (it goes from here)', async () => {
        setBridgelessWindow(true);
        const f = forward();
        const u = ui();
        await u.launchResearchLink(`strom-research://new?token=abc&app=x`, 'terminal');
        expect(busy.calls[0].opts.relayed).toBeUndefined();
        expect(f.run).not.toHaveBeenCalled();
    });
});

describe('researchLinkActionOf: a link read back as what built it', () => {
    const cases: [ResearchLinkAction, Omit<ResearchLinkParams, 'tree'>][] = [
        ['open', {}],
        ['live', { liveDo: 'start' }],
        ['chat', { person: 'P0012' }],
        ['chat', { research: 'G0002' }],
        ['direction', { research: 'G0002', directionDo: 'pause' }],
        ['finish', { run: 'run-1a07' }],
        ['experiment', { experiment: 'placeHistory', experimentDo: 'off' }],
        ['history', { place: 'L0007', historyDo: 'search' }],
        ['house', { houseDo: 'import' }],
        ['history-kinds', { kindsScope: 'tree', inherit: true }],
        ['history-kinds', { kindsScope: 'default', kinds: 'all,-law' }],
        ['hypothesis', { hypothesis: 'H0022', hypothesisDo: 'decide', variant: 'B' }],
        ['hypotheses', { hypothesesDo: 'accept', ids: ['H0001', 'H0002'] }],
        ['hypotheses', { decide: 'agent' }],
        ['history-align', { prune: true }],
        ['work', { workDo: 'tasks', workTasks: ['T0412', 'T0413'] }],
        ['work', { workDo: 'tasks', n: 7, research: 'G0002' }],
        ['book', { book: 'B0003', bookDo: 'folder' }],
        ['places', { placesDo: 'run', place: 'L0007' }],
        ['fixes', { fix: 'street-places', fixDo: 'undo' }],
        ['task', { task: 'T0815', taskDo: 'chat' }],
        ['conflict', { conflict: 'X0007', conflictDo: 'decide', take: 'user' }],
        ['story', { person: 'P0001', partner: 'P0002', storyDo: 'keep' }],
        ['sync-undo', { intake: 'I0042' }],
        ['review', { person: 'P0012', scope: 'family' }],
        ['research', { person: 'P0012', direction: 'descendants' }],
    ];

    it('every link built is read back to the same link (and what the main window takes of it)', () => {
        for (const [action, p] of cases) {
            const url = researchSchemeUrl(action, { tree: RID, ...p });
            expect(url, action).not.toBeNull();
            const r = researchLinkActionOf(url!);
            expect(r?.link, url!).toBe(action);
            expect(researchSchemeUrl(r!.link, { tree: RID, ...r!.params } as unknown as ResearchLinkParams)).toBe(url);
            expect(readOverviewAction('research-link', r), url!).not.toBeNull();
        }
    });

    it('another scheme announced by the research is kept', () => {
        const url = researchSchemeUrl('open', { tree: RID }, 'strom-research-beta')!;
        expect(researchLinkActionOf(url)).toEqual({ link: 'open', params: {} });
    });

    it('anything not built so is not read', () => {
        for (const bad of [
            'not a link', 'https://example.org/?tree=x', `strom-research://open`, `strom-research://open?tree=nope`,
            `strom-research://open?tree=${RID}&tree=${RID}`, `strom-research://open?tree=${RID}&extra=1`,
            `strom-research://places?tree=${RID}&do=run&do=run`, `strom-research://places?tree=${RID}&do=stop`,
            `strom-research://chat?tree=${RID}&person=Jan%20Nov%C3%A1k`, `strom-research://unknown?tree=${RID}`,
            `strom-research://open/x?tree=${RID}`, `strom-research://open?tree=${RID}#x`,
        ]) {
            expect(researchLinkActionOf(bad), bad).toBeNull();
        }
    });
});
