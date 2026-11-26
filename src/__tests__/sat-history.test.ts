/**
 * The history layer in a window of its own (a tree's satellite, no bridge
 * address there): a hiding made there is queued and sent by the main window
 * (`history-hide`), which holds the bridge and the device's queue — kept in
 * the satellite it was never sent, and the main window's next save dropped
 * it; "History of places" and the alignment open in the main window
 * (`history-step`, the main window forward), and the card's "Find first",
 * "Search again", a place's own history and switching the search off are
 * written through the main window's bridge, their answer said in the
 * satellite as the main window says it. With the main window closed, and in
 * the main window itself, as before. Invented data.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/** The device's records (shared by the windows of one browser) and what reached the bridge. */
const shared = vi.hoisted(() => ({
    store: new Map<string, unknown>(),
    hides: [] as unknown[],
    first: [] as unknown[],
    firstReply: null as unknown,
}));

vi.mock('../history-store.js', () => ({
    loadHistoryCache: async () => null,
    saveHistoryCache: async () => undefined,
    loadHideQueue: async (rid: string) => structuredClone((shared.store.get(`q:${rid}`) as unknown[]) ?? []),
    saveHideQueue: async (rid: string, q: readonly unknown[]) => {
        if (q.length) shared.store.set(`q:${rid}`, structuredClone([...q]));
        else shared.store.delete(`q:${rid}`);
    },
    deleteHistoryStore: async () => undefined,
}));

vi.mock('../history-bridge.js', async (orig) => ({
    ...(await orig<typeof import('../history-bridge.js')>()),
    postBridgeHide: async (_base: string, body: unknown) => {
        shared.hides.push(body);
        return { ok: true, hidden: [], head: '', parent: '' };
    },
    postBridgeFirst: async (base: string, region: string) => {
        shared.first.push({ base, region });
        return shared.firstReply ?? { ok: true, head: 'b'.repeat(40), parent: 'a'.repeat(40) };
    },
}));

const RID = 'r-hist-0417';
const BRIDGE = 'http://127.0.0.1:47231';
const FEATURES = ['history.events', 'history.hide', 'history.hideAll', 'history.first', 'history.skip', 'history.place', 'experiments.off'];

let strings: typeof import('../strings.js').strings;

type Methods = Record<string, (...args: unknown[]) => unknown>;
type Fn = ReturnType<typeof vi.fn>;

/** One window of the app: its own modules (a page), the history layer's methods and what it needs of the rest of the UI. */
async function page(opts: { satellite: boolean }) {
    vi.resetModules();
    const device = await import('../research-device.js');
    device.setBridgelessWindow(opts.satellite);
    const { DataManager } = await import('../data.js');
    const { TreeManager } = await import('../tree-manager.js');
    vi.spyOn(DataManager, 'isViewMode').mockReturnValue(false);
    vi.spyOn(DataManager, 'getCurrentTreeId').mockReturnValue('tree-hist' as never);
    vi.spyOn(DataManager, 'getData').mockReturnValue({ persons: {} } as never);
    vi.spyOn(TreeManager, 'getTreeMetadata').mockReturnValue({ name: 'Haberzettl', research: { id: RID } } as never);
    const sat = await import('../windows/window-sat-research.js');
    const main = await import('../ui/sat-research-main.js');
    const { historyMethods } = await import('../ui/history-ui.js') as unknown as { historyMethods: Methods };
    const { historyCardMethods } = await import('../ui/history-card-ui.js') as unknown as { historyCardMethods: Methods };
    const { historyManageMethods } = await import('../ui/history-manage-ui.js') as unknown as { historyManageMethods: Methods };
    const { historyAlignMethods } = await import('../ui/history-align-ui.js') as unknown as { historyAlignMethods: Methods };
    const { historyPlaceMethods } = await import('../ui/history-place-ui.js') as unknown as { historyPlaceMethods: Methods };
    const { strings: pageStrings } = await import('../strings.js');
    strings = pageStrings;
    const ui = Object.assign({}, historyMethods, historyCardMethods, historyManageMethods, historyAlignMethods, historyPlaceMethods, {
        researchBridgeUp: vi.fn(() => true),
        researchStatusOf: vi.fn(() => ({ features: FEATURES })),
        researchWriteHeldNow: vi.fn(() => false),
        researchHeadNow: vi.fn(() => 'a'.repeat(40)),
        researchTakeOwnWriteHead: vi.fn(),
        researchLinkAvailable: vi.fn(() => false),
        researchWriteHeldText: vi.fn(() => ({ toast: 'Sealed on the other computer.' })),
        historyChanged: vi.fn(),
        renderHistorySettingsIfOpen: vi.fn(),
        closeLifelineHistoryPopups: vi.fn(),
        showToast: vi.fn(),
        readBridgeHistory: vi.fn(async () => undefined),
    }) as unknown as Methods & Record<string, Fn>;
    return { ui, sat, main };
}

const flush = async (): Promise<void> => {
    for (let i = 0; i < 20; i++) await new Promise(r => setTimeout(r, 0));
};

function stubBrowser(): void {
    vi.stubGlobal('localStorage', {
        getItem: (k: string) => (k === `strom-research-bridge:${RID}` ? JSON.stringify({ base: BRIDGE }) : null),
        setItem: () => undefined, removeItem: () => undefined,
    });
    vi.stubGlobal('document', {
        activeElement: null, body: {}, getElementById: () => null, querySelector: () => null, querySelectorAll: () => [],
        addEventListener: () => undefined, removeEventListener: () => undefined,
    });
}

describe('the history layer in a satellite window', { timeout: 60_000 }, () => {
    beforeEach(() => {
        shared.store.clear();
        shared.hides.length = 0;
        shared.first.length = 0;
        shared.firstReply = null;
        stubBrowser();
    });

    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    describe('a hiding made in a satellite (history-hide)', () => {
        it('reaches the research through the main window, and the main window\'s own next hiding does not drop it', async () => {
            const mainWin = await page({ satellite: false });
            mainWin.main.registerSatelliteResearchActions(mainWin.ui as never);
            // The main window has read the device's queue (empty) when it opened.
            await mainWin.ui.ensureHistoryCache(RID);

            const satWin = await page({ satellite: true });
            satWin.sat.setSatResearchForward({
                mainOpen: () => true,
                run: (id: string, args: unknown) => { mainWin.sat.runMainResearchAction(id, args); },
                ask: async (id: string, args: unknown) => mainWin.sat.runMainResearchAction(id, args).result,
            });
            await satWin.ui.applyHistoryHide({ event: 'EV-0091', tree: true, at: '2026-11-20T10:00:00.000Z' });
            await flush();
            // The satellite shows it at once (its queue as it applies), without a queue of its own on the device.
            expect(satWin.ui.historyChanged).toHaveBeenCalled();

            await mainWin.ui.applyHistoryHide({ event: 'EV-0092', tree: true, at: '2026-11-20T10:01:00.000Z' });
            await flush();
            expect(shared.hides).toEqual([{ event: 'EV-0091', tree: true }, { event: 'EV-0092', tree: true }]);
            expect(shared.store.has(`q:${RID}`)).toBe(false);
        });

        it('the satellite keeps nothing for the device and sends nothing itself; the main window gets the hiding', async () => {
            const satWin = await page({ satellite: true });
            const f = { mainOpen: vi.fn(() => true), run: vi.fn(), ask: vi.fn() };
            satWin.sat.setSatResearchForward(f);
            const op = { event: 'EV-0093', personId: 'p-0731', at: '2026-11-20T10:02:00.000Z' };
            await satWin.ui.applyHistoryHide(op);
            await flush();
            expect(f.run).toHaveBeenCalledWith(satWin.sat.HISTORY_HIDE_ACTION, { op }, false);
            expect(shared.store.size).toBe(0);
            expect(shared.hides).toEqual([]);
        });

        it('with the main window closed the satellite keeps it for the device, as before', async () => {
            const satWin = await page({ satellite: true });
            const f = { mainOpen: vi.fn(() => false), run: vi.fn(), ask: vi.fn() };
            satWin.sat.setSatResearchForward(f);
            await satWin.ui.applyHistoryHide({ event: 'EV-0094', tree: true, at: '2026-11-20T10:03:00.000Z' });
            await flush();
            expect(f.run).not.toHaveBeenCalled();
            expect(shared.store.get(`q:${RID}`)).toEqual([{ event: 'EV-0094', tree: true, at: '2026-11-20T10:03:00.000Z' }]);
        });

        it('the main window runs only a well-formed hiding', async () => {
            const mainWin = await page({ satellite: false });
            const applyHistoryHide = vi.fn(async () => undefined);
            mainWin.main.registerSatelliteResearchActions({ applyHistoryHide } as never);
            const run = (args: unknown) => mainWin.sat.runMainResearchAction(mainWin.sat.HISTORY_HIDE_ACTION, args);
            expect(run({ op: { event: 'EV-1', tree: true, at: '2026-11-20T10:00:00Z', do: 'show' } }).handled).toBe(true);
            expect(applyHistoryHide).toHaveBeenCalledWith({ event: 'EV-1', tree: true, at: '2026-11-20T10:00:00Z', do: 'show' });
            for (const bad of [null, {}, { op: { event: 'EV-2', at: '2026-11-20T10:00:00Z' } }, { op: { event: 'EV-3', tree: true } },
                { op: { region: 'a/b', at: '2026-11-20T10:00:00Z' } }, { op: { event: 'EV-4', tree: true, at: 'x' }, more: 1 }]) {
                run(bad);
            }
            expect(applyHistoryHide).toHaveBeenCalledTimes(1);
        });
    });

    describe('"History of places" and the alignment open in the main window (history-step)', () => {
        it('the manager at its tab and place, the alignment: the main window forward; no "bridge not running" here', async () => {
            const satWin = await page({ satellite: true });
            const f = { mainOpen: vi.fn(() => true), run: vi.fn(), ask: vi.fn() };
            satWin.sat.setSatResearchForward(f);
            satWin.ui.openHistoryManage({ tab: 'places', place: 'brno|cz' });
            satWin.ui.openHistoryManage({ region: 'cz-moravia' });
            satWin.ui.openHistoryAlignDialog();
            expect(f.run.mock.calls).toEqual([
                [satWin.sat.HISTORY_STEP_ACTION, { step: 'manage', tab: 'places', place: 'brno|cz' }, true],
                [satWin.sat.HISTORY_STEP_ACTION, { step: 'manage', region: 'cz-moravia' }, true],
                [satWin.sat.HISTORY_STEP_ACTION, { step: 'align' }, true],
            ]);
            expect(satWin.ui.showToast).not.toHaveBeenCalled();
        });

        it('with the main window closed the satellite\'s own dialogs, as before', async () => {
            const satWin = await page({ satellite: true });
            const f = { mainOpen: vi.fn(() => false), run: vi.fn(), ask: vi.fn() };
            satWin.sat.setSatResearchForward(f);
            satWin.ui.openHistoryManage({ tab: 'hidden' });
            satWin.ui.openHistoryAlignDialog();
            expect(f.run).not.toHaveBeenCalled();
            expect(satWin.ui.showToast).toHaveBeenCalledTimes(1);
        });

        it('the main window opens them, and runs only well-formed steps', async () => {
            const mainWin = await page({ satellite: false });
            const deps = { openHistoryManage: vi.fn(), openHistoryAlignDialog: vi.fn(), historyWriteHere: vi.fn(async () => ({ ok: true })) };
            mainWin.main.registerSatelliteResearchActions(deps as never);
            const run = (args: unknown) => mainWin.sat.runMainResearchAction(mainWin.sat.HISTORY_STEP_ACTION, args);
            run({ step: 'manage', tab: 'deleted' });
            run({ step: 'align' });
            run({ step: 'first', region: 'cz-moravia' });
            run({ step: 'place', place: 'L0042' });
            run({ step: 'off', which: 'regions' });
            expect(deps.openHistoryManage).toHaveBeenCalledWith({ tab: 'deleted' });
            expect(deps.openHistoryAlignDialog).toHaveBeenCalledTimes(1);
            expect(deps.historyWriteHere.mock.calls).toEqual([
                [{ step: 'first', region: 'cz-moravia' }], [{ step: 'place', place: 'L0042' }], [{ step: 'off', which: 'regions' }],
            ]);
            for (const bad of [{ step: 'manage', tab: 'other' }, { step: 'align', x: 1 }, { step: 'first', region: '../x' },
                { step: 'place', place: 'brno' }, { step: 'off', which: 'all' }, { step: 'delete', event: 'EV-1' }, 'align']) {
                run(bad);
            }
            expect(deps.openHistoryManage).toHaveBeenCalledTimes(1);
            expect(deps.openHistoryAlignDialog).toHaveBeenCalledTimes(1);
            expect(deps.historyWriteHere).toHaveBeenCalledTimes(3);
        });
    });

    describe('the card\'s steps written through the main window\'s bridge', () => {
        it('"Find first" of a satellite\'s card: the main window\'s bridge writes it; the satellite says the answer', async () => {
            const mainWin = await page({ satellite: false });
            mainWin.main.registerSatelliteResearchActions(mainWin.ui as never);
            const satWin = await page({ satellite: true });
            satWin.sat.setSatResearchForward({
                mainOpen: () => true, run: () => undefined,
                ask: async (id: string, args: unknown) => mainWin.sat.runMainResearchAction(id, args).result,
            });
            expect(satWin.ui.historyManageContext()).toMatchObject({ base: null, viaMain: true });
            await satWin.ui.lifelineHistoryFind('cz-moravia');
            expect(shared.first).toEqual([{ base: BRIDGE, region: 'cz-moravia' }]);
            // The research's new head and the read again are the main window's; the satellite only says it.
            expect(mainWin.ui.researchTakeOwnWriteHead).toHaveBeenCalled();
            expect(satWin.ui.researchTakeOwnWriteHead).not.toHaveBeenCalled();
            const row = satWin.ui.lifelineHistoryFindRow([{ id: 'cz-moravia' }], (text: string, extra = '') => `<row>${text}${extra}</row>`) as string;
            expect(row).toContain('<row>');
            expect(row).not.toContain('data-find=');
        });

        it('a refusal held elsewhere comes in the main window\'s words; a foreign link is not passed on', async () => {
            const mainWin = await page({ satellite: false });
            mainWin.main.registerSatelliteResearchActions(mainWin.ui as never);
            shared.firstReply = {
                ok: false, code: 'held', status: 409, reason: '', bridgeCode: 'research.sealed', held: { kind: 'sealed' }, link: 'https://example.org/x',
            };
            const answer = await mainWin.sat.runMainResearchAction(mainWin.sat.HISTORY_STEP_ACTION, { step: 'first', region: 'cz-moravia' }).result;
            const read = mainWin.sat.readHistoryWriteResult(answer);
            expect(read).toEqual({ ok: false, code: 'held', status: 409, reason: 'Sealed on the other computer.', bridgeCode: 'research.sealed' });
            expect(mainWin.sat.readHistoryWriteResult(null)).toEqual(mainWin.sat.HISTORY_NO_ANSWER);
            expect(mainWin.sat.readHistoryWriteResult({ ok: true })).toEqual(mainWin.sat.HISTORY_NO_ANSWER);
        });

        it('no answer from the main window: the satellite says the write did not go', async () => {
            const satWin = await page({ satellite: true });
            satWin.sat.setSatResearchForward({ mainOpen: () => true, run: () => undefined, ask: async () => null });
            await satWin.ui.lifelineHistoryFind('cz-moravia');
            expect(shared.first).toEqual([]);
            const row = satWin.ui.lifelineHistoryFindRow([{ id: 'cz-moravia' }], (text: string, extra = '') => `<row>${text}${extra}</row>`) as string;
            expect(row).toContain(strings.live.waitingWrite.writeFailed);
        });

        it('switching the search off in a satellite goes through the main window\'s bridge, not its terminal', async () => {
            const satWin = await page({ satellite: true });
            const f = { mainOpen: vi.fn(() => true), run: vi.fn(), ask: vi.fn(async () => ({ ok: true, head: 'c'.repeat(40), parent: 'b'.repeat(40) })) };
            satWin.sat.setSatResearchForward(f);
            satWin.ui.launchResearchLink = vi.fn((..._args: unknown[]) => undefined) as never;
            const ok = await satWin.ui.historyDisableSearch('regions', { quiet: true });
            expect(ok).toBe(true);
            expect(f.ask).toHaveBeenCalledWith(satWin.sat.HISTORY_STEP_ACTION, { step: 'off', which: 'regions' }, expect.any(Number));
            expect(satWin.ui.launchResearchLink).not.toHaveBeenCalled();
            expect(satWin.ui.researchTakeOwnWriteHead).not.toHaveBeenCalled();
        });
    });
});
