/**
 * The places' steps of a satellite window (a map or Places in a window of its
 * own): the satellite holds no bridge address, so Look up, Check, Remove from
 * the queue and the read of the research's places go through the main
 * window's bridge (`places-queue`, `places-live`), and the satellite says the
 * bridge's reply as the main window would. Run now / Fix in the research are
 * handed over by the main window (`research-link`), and "Houses of the town ›"
 * opens the Houses window there (`houses-open`) when the tree has a research.
 * The main window's own steps and a research really elsewhere are unchanged.
 * Invented data.
 */

import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';

const busy = vi.hoisted(() => ({ calls: [] as { url: string; opts: Record<string, unknown>; deps: { handOver(link: string): void } }[] }));
vi.mock('../ui/research-open-busy.js', async (importOriginal) => {
    const real = await importOriginal<typeof import('../ui/research-open-busy.js')>();
    return {
        ...real,
        openResearchBusy: vi.fn(async (_el: unknown, url: string, opts: Record<string, unknown>, deps: { handOver(link: string): void }) => {
            busy.calls.push({ url, opts, deps });
            return 'opened';
        }),
    };
});

import { DataManager } from '../data.js';
import { TreeManager } from '../tree-manager.js';
import { setBridgelessWindow } from '../research-device.js';
import { setMirroredResearchStatus } from '../ui/research-sync-ui.js';
import {
    HOUSES_OPEN_ACTION, PLACES_LIVE_ACTION, PLACES_QUEUE_ACTION, clearMainResearchActions, readHousesOpenArgs,
    readPlacesLiveArgs, readPlacesQueueArgs, relayedPlacesLink, runMainResearchAction, setSatResearchForward,
} from '../windows/window-sat-research.js';
import { registerSatelliteResearchActions, type SatResearchMainDeps } from '../ui/sat-research-main.js';
import { placesView } from '../ui/places-identify-ui.js';
import type { PlacesResearchContext } from '../ui/places-research-ui.js';
import type { PlacesIdentifyBody } from '../places-bridge.js';
import type { LiveStatus } from '../research-link.js';
import type { BusyCtl } from '../ui/busy.js';

const TREE = 'tree_1700000000000_ab12c';
const RID = '0b4c7a52-1c1f-4d7e-9a53-2f4a3c1e8b10';
const BRIDGE = 'http://127.0.0.1:5997/0123456789abcdef0123456789abcdef';
const STATUS = { treeId: RID, features: ['places.identify'] } as unknown as LiveStatus;

type Fn = ReturnType<typeof vi.fn>;
type Ui = {
    placesResearchContext(): PlacesResearchContext;
    sendPlacesIdentify(body: PlacesIdentifyBody, keys: readonly string[], check: boolean, ctl?: BusyCtl): Promise<boolean>;
    unqueuePlaceForms(forms: readonly string[], keys: readonly string[], opts?: { ctl?: BusyCtl; inToast?: boolean }): Promise<unknown>;
    loadPlacesLive(maxAgeMs?: number, fresh?: boolean): Promise<boolean>;
    placesIdentifyHere(body: PlacesIdentifyBody): Promise<unknown>;
    launchPlacesLink(url: string): void;
    showTownHouses(town: string, parent?: string): void;
    showToast: Fn;
    launchResearchLink: Fn;
    showHousesWindow: Fn;
    refreshPlacesLive: Fn;
};

describe('place steps of a satellite window', () => {
    let methods: Record<string, unknown>;
    let store: Map<string, string>;
    let fetchMock: Fn;

    beforeAll(async () => {
        const mod = async <T>(p: Promise<unknown>, k: string): Promise<T> => (await p as Record<string, T>)[k];
        const research = await mod<Record<string, unknown>>(import('../ui/places-research-ui.js'), 'placesResearchMethods');
        const sync = await mod<Record<string, unknown>>(import('../ui/research-sync-ui.js'), 'researchSyncMethods');
        const identify = await mod<Record<string, unknown>>(import('../ui/places-identify-ui.js'), 'placesIdentifyMethods');
        const houses = await mod<Record<string, unknown>>(import('../ui/houses-ui.js'), 'housesMethods');
        methods = {
            researchBridgeUp: sync.researchBridgeUp,
            researchStatusOf: sync.researchStatusOf,
            placesResearchContext: research.placesResearchContext,
            launchPlacesLink: research.launchPlacesLink,
            sendPlacesIdentify: identify.sendPlacesIdentify,
            unqueuePlaceForms: identify.unqueuePlaceForms,
            placesIdentifyWrite: identify.placesIdentifyWrite,
            placesIdentifyHere: identify.placesIdentifyHere,
            placesSkippedText: identify.placesSkippedText,
            placesRefusalEnd: identify.placesRefusalEnd,
            placesRefusalText: identify.placesRefusalText,
            loadPlacesLive: identify.loadPlacesLive,
            showTownHouses: houses.showTownHouses,
        };
    }, 60000);

    beforeEach(() => {
        store = new Map();
        busy.calls = [];
        vi.stubGlobal('localStorage', {
            getItem: (k: string) => store.get(k) ?? null,
            setItem: (k: string, v: string) => { store.set(k, v); },
            removeItem: (k: string) => { store.delete(k); },
            key: (i: number) => [...store.keys()][i] ?? null,
            get length() { return store.size; },
        });
        vi.stubGlobal('document', { getElementById: () => null });
        fetchMock = vi.fn(async () => { throw new Error('no bridge in a satellite'); });
        vi.stubGlobal('fetch', fetchMock);
        vi.spyOn(DataManager, 'isViewMode').mockReturnValue(false);
        vi.spyOn(DataManager, 'getCurrentTreeId').mockReturnValue(TREE as never);
        vi.spyOn(TreeManager, 'getTreeMetadata').mockReturnValue({ research: { id: RID, fingerprint: 'f', syncedAt: '2026-10-01T08:00:00Z' } } as never);
        // The places of the step: Horní Lhota written one way, Jinov two ways.
        placesView.usages = new Map([
            ['horni lhota', { variants: new Map([['Horní Lhota', 1]]) }],
            ['jinov', { variants: new Map([['Jinov', 1], ['Jinow', 1]]) }],
        ]) as never;
        placesView.queuedLocal = new Set();
        placesView.live = null;
        placesView.selecting = false;
    });

    afterEach(() => {
        setBridgelessWindow(false);
        setSatResearchForward(null);
        setMirroredResearchStatus(RID, null);
        clearMainResearchActions();
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    const ui = (): Ui => ({
        ...methods,
        showToast: vi.fn(), launchResearchLink: vi.fn(), showHousesWindow: vi.fn(),
        redrawPlacesKeepingSearch: vi.fn(), placesLiveChanged: vi.fn(), refreshPlacesLive: vi.fn(async () => undefined),
        setPlacesSelecting: vi.fn(), showPlacesRefusal: vi.fn(),
    } as unknown as Ui);

    /** A satellite whose main window's bridge answers (`up`) or not. */
    const satellite = (up = true): void => {
        setBridgelessWindow(true);
        setMirroredResearchStatus(RID, STATUS, up);
    };

    const forward = (reply: unknown = null, open = true) => {
        const f = { mainOpen: () => open, run: vi.fn(), ask: vi.fn(async () => reply) };
        setSatResearchForward(f);
        return f;
    };

    const ctl = () => {
        const end = vi.fn();
        return { signal: new AbortController().signal, step: vi.fn(), end: end as unknown as BusyCtl['end'] & Fn };
    };

    describe('the access of the steps', () => {
        it('a satellite with the main window open and its bridge up: the steps go (through the main window)', () => {
            satellite();
            forward();
            expect(ui().placesResearchContext()).toMatchObject({ access: 'ok', viaMain: true, stepAccess: 'ok', canResearch: true, base: null });
        });

        it('with the main window closed: where the steps go, as before', () => {
            satellite();
            forward(null, false);
            expect(ui().placesResearchContext()).toMatchObject({ stepAccess: 'elsewhere', canResearch: false });
        });

        it('with the main window\'s bridge down: elsewhere, as before', () => {
            satellite(false);
            forward();
            expect(ui().placesResearchContext()).toMatchObject({ access: 'elsewhere', stepAccess: 'elsewhere', canResearch: false });
        });
    });

    describe('Look up / Check / Remove from the queue in a satellite', () => {
        it('a step goes through the main window and is said here as the main window says it, with Undo', async () => {
            satellite();
            const f = forward({ ok: true, queued: 1, skipped: [] });
            const u = ui();
            const body: PlacesIdentifyBody = { do: 'queue', forms: ['Horní Lhota'] };
            expect(await u.sendPlacesIdentify(body, ['horni lhota'], false)).toBe(true);
            expect(f.ask).toHaveBeenCalledWith(PLACES_QUEUE_ACTION, { body }, expect.any(Number));
            expect(fetchMock).not.toHaveBeenCalled();
            expect(u.showToast).toHaveBeenCalledTimes(1);
            const [text, , opts] = u.showToast.mock.calls[0] as [string, number, { action?: { label: string } }];
            expect(text).toBe('1 place queued for the research.');
            expect(opts.action?.label).toBeTruthy();
            expect(placesView.queuedLocal.has('horni lhota')).toBe(true);
        });

        it('a check sends its flags; the main window\'s refusal ends the element as the main window would', async () => {
            satellite();
            const f = forward({ ok: false, code: 'busy', status: 503, reason: '', bridgeCode: 'research.busy', retryAfter: null });
            const u = ui();
            const c = ctl();
            const body: PlacesIdentifyBody = { do: 'queue', forms: ['Jinov', 'Jinow'], check: true, flags: { Jinov: 'far' } };
            expect(await u.sendPlacesIdentify(body, ['jinov'], true, c)).toBe(false);
            expect(f.ask).toHaveBeenCalledWith(PLACES_QUEUE_ACTION, { body }, expect.any(Number));
            expect(c.end).toHaveBeenCalledWith(expect.objectContaining({ ok: false, kind: 'busy' }));
            expect(u.showToast).not.toHaveBeenCalled();
        });

        it('no answer from the main window in time: the research does not answer, Try again', async () => {
            satellite();
            forward(null);
            const u = ui();
            const c = ctl();
            expect(await u.sendPlacesIdentify({ do: 'queue', forms: ['Horní Lhota'] }, ['horni lhota'], false, c)).toBe(false);
            expect(c.end).toHaveBeenCalledWith(expect.objectContaining({ ok: false, kind: 'offline', text: 'The research does not answer.' }));
            expect(c.end.mock.calls[0][0].retry).toBeTypeOf('function');
        });

        it('Remove from the queue goes through the main window too', async () => {
            satellite();
            placesView.queuedLocal.add('jinov');
            const f = forward({ ok: true, queued: 0, cancelled: 2, skipped: [] });
            const u = ui();
            await u.unqueuePlaceForms(['Jinov', 'Jinow'], ['jinov']);
            expect(f.ask).toHaveBeenCalledWith(PLACES_QUEUE_ACTION, { body: { do: 'cancel', forms: ['Jinov', 'Jinow'] } }, expect.any(Number));
            expect(u.showToast).toHaveBeenCalledWith('Removed from the queue.', expect.any(Number));
            expect(placesView.queuedLocal.has('jinov')).toBe(false);
        });

        it('the main window writes a step to its own bridge, as before', async () => {
            store.set(`strom-research-bridge:${RID}`, JSON.stringify({ base: BRIDGE }));
            setMirroredResearchStatus(RID, STATUS, true);
            const f = forward({ ok: true, queued: 1, skipped: [] });
            fetchMock.mockImplementation(async () => new Response(JSON.stringify({ ok: true, queued: 1, skipped: [] }), { status: 200 }));
            const u = ui();
            expect(await u.sendPlacesIdentify({ do: 'queue', forms: ['Horní Lhota'] }, ['horni lhota'], false)).toBe(true);
            expect(f.ask).not.toHaveBeenCalled();
            expect(String(fetchMock.mock.calls[0][0])).toMatch(`${BRIDGE}/places/identify`);
        });
    });

    describe('the research\'s places read in a satellite', () => {
        it('through the main window, its states shown here', async () => {
            satellite();
            const payload = { rev: 'p2', places: {}, forms: { 'Horní Lhota': { state: 'queued' } }, formsByKey: {} };
            const f = forward({ ok: true, payload });
            expect(await ui().loadPlacesLive(0, true)).toBe(true);
            expect(f.ask).toHaveBeenCalledWith(PLACES_LIVE_ACTION, {}, expect.any(Number));
            expect(placesView.live).toEqual({ researchId: RID, payload });
            expect(fetchMock).not.toHaveBeenCalled();
        });

        it('no answer: nothing changes', async () => {
            satellite();
            forward(null);
            expect(await ui().loadPlacesLive(0, true)).toBe(false);
            expect(placesView.live).toBeNull();
        });
    });

    describe('Run now and Fix in the research in a satellite', () => {
        it('the main window hands the link over (relayed: no proof asked here)', () => {
            satellite();
            const f = forward();
            const u = ui();
            u.launchPlacesLink(`strom-research://places?tree=${RID}&do=run&place=L0007`);
            expect(u.launchResearchLink).not.toHaveBeenCalled();
            expect(busy.calls).toHaveLength(1);
            expect(busy.calls[0].opts).toMatchObject({ relayed: true });
            busy.calls[0].deps.handOver(busy.calls[0].url);
            expect(f.run).toHaveBeenCalledWith('research-link', { link: 'places', params: { placesDo: 'run', place: 'L0007' } }, false);
        });

        it('the main window launches its own link as before', () => {
            const u = ui();
            const url = `strom-research://places?tree=${RID}&do=run`;
            u.launchPlacesLink(url);
            expect(u.launchResearchLink).toHaveBeenCalledWith(url, 'terminal', null, {});
            expect(busy.calls).toHaveLength(0);
        });

        it('reads only the places\' links it can name again', () => {
            expect(relayedPlacesLink(`strom-research://places?tree=${RID}&do=run`)).toEqual({ link: 'places', params: { placesDo: 'run' } });
            expect(relayedPlacesLink(`strom-research://fixes?tree=${RID}`)).toEqual({ link: 'fixes', params: {} });
            expect(relayedPlacesLink(`strom-research://fixes?tree=${RID}&id=street-places`)).toEqual({ link: 'fixes', params: { fix: 'street-places' } });
            expect(relayedPlacesLink(`strom-research://fixes?tree=${RID}&id=street-places&do=undo`))
                .toEqual({ link: 'fixes', params: { fix: 'street-places', fixDo: 'undo' } });
            for (const bad of [`strom-research://places?tree=${RID}`, `strom-research://places?tree=${RID}&do=run&do=run`,
                `strom-research://chat?tree=${RID}`, 'not a link', `strom-research://fixes?tree=${RID}&do=undo`]) {
                expect(relayedPlacesLink(bad)).toBeNull();
            }
        });
    });

    describe('Houses of the town in a satellite', () => {
        it('with a research and the main window\'s bridge up: opened in the main window, which comes forward', () => {
            satellite();
            const f = forward();
            const u = ui();
            u.showTownHouses('Lhota', 'places-modal');
            expect(f.run).toHaveBeenCalledWith(HOUSES_OPEN_ACTION, { town: 'Lhota' }, true);
            expect(u.showHousesWindow).not.toHaveBeenCalled();
        });

        it('without a research: the satellite\'s own Houses window, as before', () => {
            vi.mocked(TreeManager.getTreeMetadata).mockReturnValue({} as never);
            satellite();
            const f = forward();
            const u = ui();
            u.showTownHouses('Lhota');
            expect(f.run).not.toHaveBeenCalled();
            expect(u.showHousesWindow).toHaveBeenCalledWith({ town: 'Lhota' });
        });

        it('with the main window\'s bridge down, or in the main window: here, as before', () => {
            satellite(false);
            const f = forward();
            const u = ui();
            u.showTownHouses('Lhota');
            setBridgelessWindow(false);
            setMirroredResearchStatus(RID, STATUS, true);
            u.showTownHouses('Lhota');
            expect(f.run).not.toHaveBeenCalled();
            expect(u.showHousesWindow).toHaveBeenCalledTimes(2);
        });
    });

    describe('the main window runs the satellite\'s place actions', () => {
        const deps = (): SatResearchMainDeps & Record<string, Fn> => ({
            showPlacesManager: vi.fn(), openPlacesBulk: vi.fn(), showHousesWindow: vi.fn(),
            openHousePage: vi.fn((id: string) => id !== 'lhota|99'),
            placesIdentifyHere: vi.fn(async () => ({ ok: true, queued: 1, skipped: [] })),
            placesLiveHere: vi.fn(async () => null),
        }) as never;

        it('places-queue with a valid step only; its outcome goes back', async () => {
            const d = deps();
            registerSatelliteResearchActions(d);
            const body = { do: 'queue', forms: ['Jinov'], check: true, flags: { Jinov: 'far' } };
            const out = runMainResearchAction(PLACES_QUEUE_ACTION, { body });
            expect(out.handled).toBe(true);
            expect(await out.result).toEqual({ ok: true, queued: 1, skipped: [] });
            expect(d.placesIdentifyHere).toHaveBeenCalledWith(body);
            for (const bad of [null, {}, { body: null }, { body: { do: 'run', forms: ['A'] } }, { body: { do: 'queue' } },
                { body: { do: 'queue', forms: 'Jinov' } }, { body: { do: 'queue', forms: [7] } }, { body: { do: 'queue', all: 'queued' } },
                { body: { do: 'cancel', forms: ['A'], check: true } }, { body: { do: 'queue', forms: ['A'], flags: { A: 'bad' } } },
                { body: { do: 'queue', forms: ['A'] }, url: BRIDGE }, { body: { do: 'queue', forms: ['A'], base: BRIDGE } }]) {
                expect(runMainResearchAction(PLACES_QUEUE_ACTION, bad)).toEqual({ handled: true });
            }
            expect(d.placesIdentifyHere).toHaveBeenCalledTimes(1);
        });

        it('reads the steps it takes', () => {
            expect(readPlacesQueueArgs({ body: { do: 'queue', all: 'offmap' } })).toEqual({ body: { do: 'queue', all: 'offmap' } });
            expect(readPlacesQueueArgs({ body: { do: 'cancel', forms: ['A', 'B'] } })).toEqual({ body: { do: 'cancel', forms: ['A', 'B'] } });
            expect(readPlacesQueueArgs({ body: { do: 'queue', forms: ['A'], check: false } })).toEqual({ body: { do: 'queue', forms: ['A'] } });
            expect(readPlacesLiveArgs({})).toEqual({});
            expect(readPlacesLiveArgs({ rev: 'p3' })).toEqual({ rev: 'p3' });
            expect(readPlacesLiveArgs({ rev: 3 })).toBeNull();
            expect(readPlacesLiveArgs({ rev: 'p3', base: BRIDGE })).toBeNull();
        });

        it('places-live and houses-open', async () => {
            const d = deps();
            registerSatelliteResearchActions(d);
            await runMainResearchAction(PLACES_LIVE_ACTION, { rev: 'p3' }).result;
            expect(d.placesLiveHere).toHaveBeenCalledWith('p3');
            // A house: its page (spec 030 §3); one the main window's tree does not have: the Houses window on the town.
            expect(runMainResearchAction(HOUSES_OPEN_ACTION, { town: 'Lhota', house: 'lhota|12' })).toEqual({ handled: true, result: true });
            expect(d.openHousePage).toHaveBeenCalledWith('lhota|12');
            expect(d.showHousesWindow).not.toHaveBeenCalled();
            expect(runMainResearchAction(HOUSES_OPEN_ACTION, { town: 'Lhota', house: 'lhota|99' })).toEqual({ handled: true, result: true });
            expect(d.showHousesWindow).toHaveBeenCalledWith({ town: 'Lhota', house: 'lhota|99' });
            expect(runMainResearchAction(HOUSES_OPEN_ACTION, { town: 'Lhota' })).toEqual({ handled: true, result: true });
            expect(d.showHousesWindow).toHaveBeenCalledWith({ town: 'Lhota' });
            expect(d.showHousesWindow).toHaveBeenCalledTimes(2);
            for (const bad of [{}, { town: '' }, { town: 7 }, { town: 'Lhota', house: 3 }, { town: 'Lhota', parent: 'x' }]) {
                expect(readHousesOpenArgs(bad)).toBeNull();
                expect(runMainResearchAction(HOUSES_OPEN_ACTION, bad)).toEqual({ handled: true });
            }
            expect(d.showHousesWindow).toHaveBeenCalledTimes(2);
        });

        it('the main window without a bridge address of its own writes nothing (the satellite hears no answer)', async () => {
            setMirroredResearchStatus(RID, STATUS, true);
            const u = ui();
            expect(await u.placesIdentifyHere({ do: 'queue', forms: ['Horní Lhota'] })).toBeNull();
            expect(fetchMock).not.toHaveBeenCalled();
        });
    });
});
