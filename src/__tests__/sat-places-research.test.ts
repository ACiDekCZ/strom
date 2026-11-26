/**
 * The research's place actions in a satellite window (a map in a window of
 * its own): the satellite holds no bridge address, the main window does.
 * Whether the research's bridge answers is the main window's (mirrored with
 * its real "up"), so the map's "Look up in the research" goes to the main
 * window (Places with the preview there, the main window forward) instead of
 * saying the research is on another computer. The main window and a research
 * really elsewhere stay as they were. Invented data.
 */

import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { DataManager } from '../data.js';
import { TreeManager } from '../tree-manager.js';
import { setBridgelessWindow } from '../research-device.js';
import { setMirroredResearchStatus } from '../ui/research-sync-ui.js';
import {
    PLACES_OPEN_ACTION, clearMainResearchActions, readPlacesOpenArgs, runMainResearchAction, setSatResearchForward,
    type SatResearchForward,
} from '../windows/window-sat-research.js';
import { registerSatelliteResearchActions } from '../ui/sat-research-main.js';
import type { PlacesResearchContext } from '../ui/places-research-ui.js';
import type { LiveStatus } from '../research-link.js';

const TREE = 'tree_1700000000000_ab12c';
const RID = '0b4c7a52-1c1f-4d7e-9a53-2f4a3c1e8b10';
const BRIDGE = 'http://127.0.0.1:5997/0123456789abcdef0123456789abcdef';
const STATUS = { treeId: RID, features: ['places.identify'] } as unknown as LiveStatus;

type Ui = {
    placesResearchContext(): PlacesResearchContext;
    mapBarAction(action: 'research' | 'confirm'): void;
    openWaitingPlaces(place?: string): void;
    showToast: ReturnType<typeof vi.fn>;
    showPlacesManager: ReturnType<typeof vi.fn>;
    openPlacesBulk: ReturnType<typeof vi.fn>;
    showWaitingPlaces: ReturnType<typeof vi.fn>;
    showResearchWaiting: ReturnType<typeof vi.fn>;
};

describe('place research actions in a satellite window', () => {
    let methods: Record<string, unknown>;
    let store: Map<string, string>;

    beforeAll(async () => {
        const { placesResearchMethods } = await import('../ui/places-research-ui.js') as unknown as { placesResearchMethods: Record<string, unknown> };
        const { researchSyncMethods } = await import('../ui/research-sync-ui.js') as unknown as { researchSyncMethods: Record<string, unknown> };
        const { mapMethods } = await import('../ui/map-ui.js') as unknown as { mapMethods: Record<string, unknown> };
        const { waitingPlacesMethods } = await import('../ui/waiting-places-ui.js') as unknown as { waitingPlacesMethods: Record<string, unknown> };
        methods = {
            researchBridgeUp: researchSyncMethods.researchBridgeUp,
            researchStatusOf: researchSyncMethods.researchStatusOf,
            placesResearchContext: placesResearchMethods.placesResearchContext,
            placesResearchNote: placesResearchMethods.placesResearchNote,
            mapBarAction: mapMethods.mapBarAction,
            openWaitingPlaces: waitingPlacesMethods.openWaitingPlaces,
        };
    }, 60000);

    beforeEach(() => {
        store = new Map();
        vi.stubGlobal('localStorage', {
            getItem: (k: string) => store.get(k) ?? null,
            setItem: (k: string, v: string) => { store.set(k, v); },
            removeItem: (k: string) => { store.delete(k); },
            key: (i: number) => [...store.keys()][i] ?? null,
            get length() { return store.size; },
        });
        vi.stubGlobal('document', { getElementById: () => ({}) });
        vi.spyOn(DataManager, 'isViewMode').mockReturnValue(false);
        vi.spyOn(DataManager, 'getCurrentTreeId').mockReturnValue(TREE as never);
        vi.spyOn(TreeManager, 'getTreeMetadata').mockReturnValue({ research: { id: RID, fingerprint: 'f', syncedAt: '2026-10-01T08:00:00Z' } } as never);
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
        showToast: vi.fn(), showPlacesManager: vi.fn(), openPlacesBulk: vi.fn(),
        showWaitingPlaces: vi.fn(), showResearchWaiting: vi.fn(),
        waitingPlacesShown: () => true,
    } as unknown as Ui);

    /** A satellite whose main window's bridge answers (`up`) or not. */
    const satellite = (up: boolean): void => {
        setBridgelessWindow(true);
        setMirroredResearchStatus(RID, STATUS, up);
    };

    const forward = (open = true): SatResearchForward & { run: ReturnType<typeof vi.fn> } => {
        const f = { mainOpen: () => open, run: vi.fn(), ask: vi.fn(async () => null) };
        setSatResearchForward(f);
        return f;
    };

    describe('placesResearchContext', () => {
        it('a satellite with the main window\'s bridge up: access ok through the main window, its steps not from here yet', () => {
            satellite(true);
            const ctx = ui().placesResearchContext();
            expect(ctx.access).toBe('ok');
            expect(ctx.viaMain).toBe(true);
            expect(ctx.base).toBeNull();
            expect(ctx.stepAccess).toBe('elsewhere');
            expect(ctx.canResearch).toBe(false);
        });

        it('a satellite whose main window\'s bridge is down: elsewhere, as before', () => {
            satellite(false);
            const ctx = ui().placesResearchContext();
            expect(ctx.access).toBe('elsewhere');
            expect(ctx.stepAccess).toBe('elsewhere');
        });

        it('a satellite without any status from the main window: elsewhere, as before', () => {
            setBridgelessWindow(true);
            expect(ui().placesResearchContext().access).toBe('elsewhere');
        });

        it('the main window with its bridge here: ok, its steps go from here', () => {
            store.set(`strom-research-bridge:${RID}`, JSON.stringify({ base: BRIDGE }));
            setMirroredResearchStatus(RID, STATUS, true);
            const ctx = ui().placesResearchContext();
            expect(ctx).toMatchObject({ access: 'ok', viaMain: false, stepAccess: 'ok', canResearch: true, base: BRIDGE });
        });

        it('the main window with a status but no bridge address here (research on another computer): elsewhere', () => {
            setMirroredResearchStatus(RID, STATUS, true);
            const ctx = ui().placesResearchContext();
            expect(ctx).toMatchObject({ access: 'elsewhere', viaMain: false, stepAccess: 'elsewhere', canResearch: false });
        });
    });

    describe('the map bar in a satellite', () => {
        it('"Look up in the research" goes to the main window (Places with the look-up preview, forward), no toast', () => {
            satellite(true);
            const f = forward();
            const u = ui();
            u.mapBarAction('research');
            expect(f.run).toHaveBeenCalledWith(PLACES_OPEN_ACTION, { scope: 'tree', unplaced: true, bulk: 'look' }, true);
            expect(u.showToast).not.toHaveBeenCalled();
            expect(u.showPlacesManager).not.toHaveBeenCalled();
        });

        it('with the main window closed: as before (where the steps go)', () => {
            satellite(true);
            const f = forward(false);
            const u = ui();
            u.mapBarAction('research');
            expect(f.run).not.toHaveBeenCalled();
            expect(u.showToast).toHaveBeenCalledTimes(1);
        });

        it('with the main window\'s bridge down: as before (where the steps go), nothing sent', () => {
            satellite(false);
            const f = forward();
            const u = ui();
            u.mapBarAction('research');
            expect(f.run).not.toHaveBeenCalled();
            expect(u.showToast).toHaveBeenCalledTimes(1);
        });

        it('the main window\'s own map is unchanged: Places here with the preview', () => {
            store.set(`strom-research-bridge:${RID}`, JSON.stringify({ base: BRIDGE }));
            setMirroredResearchStatus(RID, STATUS, true);
            const u = ui();
            u.mapBarAction('research');
            expect(u.showToast).not.toHaveBeenCalled();
            expect(u.showPlacesManager).toHaveBeenCalledWith(undefined, undefined, undefined, { unplaced: true });
            expect(u.openPlacesBulk).toHaveBeenCalledWith('look');
        });

        it('"? N to confirm" opens the places\' questions in the main window (forward)', () => {
            satellite(true);
            const f = forward();
            const u = ui();
            u.mapBarAction('confirm');
            expect(f.run).toHaveBeenCalledWith('waiting-places', {}, true);
            expect(u.showWaitingPlaces).not.toHaveBeenCalled();
            expect(u.showResearchWaiting).not.toHaveBeenCalled();
            u.openWaitingPlaces('w-17');
            expect(f.run).toHaveBeenLastCalledWith('waiting-places', { focus: 'w-17' }, true);
        });

        it('"? N to confirm" in the main window opens them here', () => {
            const u = ui();
            u.openWaitingPlaces('w-17');
            expect(u.showWaitingPlaces).toHaveBeenCalledWith('w-17');
        });
    });

    describe('the main window runs places-open', () => {
        it('with valid arguments only', () => {
            const fake = { showPlacesManager: vi.fn(), openPlacesBulk: vi.fn() };
            registerSatelliteResearchActions(fake);
            expect(runMainResearchAction(PLACES_OPEN_ACTION, { scope: 'tree', unplaced: true, bulk: 'look' })).toEqual({ handled: true, result: true });
            expect(fake.showPlacesManager).toHaveBeenCalledWith(undefined, undefined, 'tree', { unplaced: true });
            expect(fake.openPlacesBulk).toHaveBeenCalledWith('look');

            for (const bad of [null, 'tree', [], { scope: 'sel', unplaced: true }, { scope: 'tree' }, { scope: 'tree', unplaced: 'yes' },
                { scope: 'tree', unplaced: true, bulk: 'run' }, { scope: 'tree', unplaced: true, url: 'x' }]) {
                expect(runMainResearchAction(PLACES_OPEN_ACTION, bad)).toEqual({ handled: true });
            }
            expect(fake.showPlacesManager).toHaveBeenCalledTimes(1);
            expect(fake.openPlacesBulk).toHaveBeenCalledTimes(1);
        });

        it('an id it does not know is left to the other handlers', () => {
            registerSatelliteResearchActions({ showPlacesManager: vi.fn(), openPlacesBulk: vi.fn() });
            expect(runMainResearchAction('waiting-places', {})).toEqual({ handled: false });
            expect(runMainResearchAction(7, {})).toEqual({ handled: false });
        });

        it('reads its arguments strictly', () => {
            expect(readPlacesOpenArgs({ scope: 'view', unplaced: false })).toEqual({ scope: 'view', unplaced: false });
            expect(readPlacesOpenArgs({ scope: 'tree', unplaced: true, bulk: 'check' })).toEqual({ scope: 'tree', unplaced: true, bulk: 'check' });
        });
    });

    describe('the mirrored bridge status (the main window\'s real "up")', () => {
        it('the main window sends whether its bridge answers now with the status', async () => {
            const { agentWindowMethods } = await import('../ui/agent-window-ui.js') as unknown as { agentWindowMethods: Record<string, unknown> };
            vi.spyOn(DataManager, 'isLocked').mockReturnValue(false);
            vi.spyOn(DataManager, 'getData').mockReturnValue({ persons: {}, partnerships: {} } as never);
            vi.spyOn(TreeManager, 'canSendToResearch').mockReturnValue(true);
            let up = true;
            const main = {
                ...agentWindowMethods,
                followedRun: () => null, isLiveFollowOn: () => false, liveFollowView: () => null,
                researchStatusOf: () => STATUS, researchBridgeUp: () => up,
            } as unknown as { agentWindowState(): { sections: { status: unknown } } };
            expect(main.agentWindowState().sections.status).toEqual({ researchId: RID, status: STATUS, up: true });
            up = false;
            expect(main.agentWindowState().sections.status).toEqual({ researchId: RID, status: STATUS, up: false });
        });

        it('a mirrored down keeps the status but the bridge does not answer here', async () => {
            const { researchSyncMethods } = await import('../ui/research-sync-ui.js') as unknown as { researchSyncMethods: Record<string, (id: string) => unknown> };
            setBridgelessWindow(true);
            setMirroredResearchStatus(RID, STATUS, false);
            expect(researchSyncMethods.researchBridgeUp(RID)).toBe(false);
            expect(researchSyncMethods.researchStatusOf(RID)).toEqual(STATUS);
            setMirroredResearchStatus(RID, STATUS);
            expect(researchSyncMethods.researchBridgeUp(RID)).toBe(true);
        });
    });
});
