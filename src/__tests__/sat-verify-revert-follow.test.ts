/**
 * Verifying, confirming and reverting facts, following the agent and the
 * card's other trees in a window of its own (a tree's satellite, no bridge
 * there): "Verify facts" (the card's tip, the person menu, a fact's tip)
 * opens the main window's preview of the person (`verify-person`, the main
 * window forward); "Confirm against the scan" and Revert are written through
 * the main window's bridge (`fact-confirm`, `fact-revert`), their answer said
 * here as the main window would say it; the agent's mark and "Follow the
 * research" follow the agent by this window's own state; the ⇄ of other
 * trees is not drawn there. With the main window closed, and in the main
 * window itself, as before. Invented data.
 */

import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';

const mirror = vi.hoisted(() => ({ session: null as unknown }));
vi.mock('../windows/agent-mirror.js', async (orig) => ({
    ...(await orig<typeof import('../windows/agent-mirror.js')>()),
    agentMirror: () => (mirror.session ? { session: () => mirror.session } : null),
}));

import { setBridgelessWindow } from '../research-device.js';
import {
    FACT_CONFIRM_ACTION, FACT_REVERT_ACTION, VERIFY_PERSON_ACTION, clearMainResearchActions, readFactConfirmResult, readRevertResult,
    runMainResearchAction, setSatResearchForward, type SatResearchForward,
} from '../windows/window-sat-research.js';
import { registerSatelliteResearchActions } from '../ui/sat-research-main.js';
import { DataManager, createEmptyData } from '../data.js';
import { SettingsManager, CARD_SIGNAL_DEFAULTS } from '../settings.js';
import { TreeManager } from '../tree-manager.js';
import { TreeRenderer } from '../renderer.js';
import { setWindowRole } from '../windows/window-role.js';
import { strings } from '../strings.js';
import type { Partnership, PartnershipId, Person, PersonId, StromData, TreeId } from '../types.js';

type Fn = ReturnType<typeof vi.fn>;
type Methods = Record<string, (...args: unknown[]) => unknown>;

const PID = 'p-0731' as PersonId;
const WIFE = 'p-0732' as PersonId;
const UNION = 'u-0090' as PartnershipId;

function person(id: PersonId, extra: Partial<Person> = {}): Person {
    return {
        id, firstName: 'Wendelin', lastName: 'Haberzettl', gender: 'male', isPlaceholder: false,
        partnerships: [UNION], parentIds: [], childIds: [], ...extra,
    } as Person;
}

function treeData(): StromData {
    const data = createEmptyData();
    data.persons[PID] = person(PID, {
        researchOrigins: { birth: { kind: 'import', parts: ['DATE'], was: { value: '3 MAR 1868', ref: 'R0042', parts: ['DATE'] } } },
    } as Partial<Person>);
    data.persons[WIFE] = person(WIFE, { firstName: 'Kunigunde', gender: 'female', refn: 'P0017' } as Partial<Person>);
    data.partnerships[UNION] = { id: UNION, person1Id: PID, person2Id: WIFE, childIds: [] } as unknown as Partnership;
    return data;
}

describe('verify, confirm, revert and following in a satellite window', () => {
    let verifyPerson: Methods;
    let verify: Methods;
    let origin: Methods;
    let research: Methods;

    beforeAll(async () => {
        ({ verifyPersonMethods: verifyPerson } = await import('../ui/verify-person-ui.js') as unknown as { verifyPersonMethods: Methods });
        ({ verifyUiMethods: verify } = await import('../ui/verify-ui.js') as unknown as { verifyUiMethods: Methods });
        ({ factOriginMethods: origin } = await import('../ui/fact-origin-ui.js') as unknown as { factOriginMethods: Methods });
        ({ researchUiMethods: research } = await import('../ui/research-ui.js') as unknown as { researchUiMethods: Methods });
    }, 60000);

    afterEach(() => {
        setBridgelessWindow(false);
        setSatResearchForward(null);
        clearMainResearchActions();
        setWindowRole('none');
        mirror.session = null;
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    function forward(open = true, answer: unknown = null) {
        const f = { mainOpen: vi.fn(() => open), run: vi.fn(), ask: vi.fn(async () => answer) };
        setSatResearchForward(f as SatResearchForward);
        return f;
    }

    function withTree(): StromData {
        const data = treeData();
        vi.spyOn(DataManager, 'getData').mockReturnValue(data);
        vi.spyOn(DataManager, 'getPerson').mockImplementation((id: PersonId) => data.persons[id] ?? null as never);
        vi.spyOn(DataManager, 'getPartnership').mockImplementation((id: PartnershipId) => data.partnerships[id] ?? null as never);
        vi.stubGlobal('document', { activeElement: null, body: {}, getElementById: () => null, querySelector: () => null, querySelectorAll: () => [] });
        vi.stubGlobal('CSS', { escape: (t: string) => t });
        return data;
    }

    describe('"Verify facts" opens the main window\'s preview (verify-person)', () => {
        const ui = () => ({
            hideContextMenu: vi.fn(), showToast: vi.fn(), verifyBridgeNow: vi.fn(() => null),
            showVerifyPersonDialog: verifyPerson.showVerifyPersonDialog,
        }) as unknown as Record<string, Fn> & Methods;

        it('the card\'s tip, the menu, the edit form\'s row: the main window\'s preview, forward; nothing fails here', () => {
            setBridgelessWindow(true);
            const f = forward();
            const u = ui();
            u.showVerifyPersonDialog(PID);
            u.showVerifyPersonDialog(PID, { prioritize: true });
            expect(f.run.mock.calls).toEqual([
                [VERIFY_PERSON_ACTION, { personId: PID }, true],
                [VERIFY_PERSON_ACTION, { personId: PID, prioritize: true }, true],
            ]);
            expect(u.showToast).not.toHaveBeenCalled();
            expect(u.hideContextMenu).toHaveBeenCalledTimes(2);
        });

        it('with the main window closed (and in the main window) as before', () => {
            setBridgelessWindow(true);
            const f = forward(false);
            const u = ui();
            u.showVerifyPersonDialog(PID);
            expect(f.run).not.toHaveBeenCalled();
            expect(u.showToast).toHaveBeenCalledWith(strings.verify.failed, 5000);
            setBridgelessWindow(false);
            forward(true);
            u.showVerifyPersonDialog(PID);
            expect(u.showToast).toHaveBeenCalledTimes(2);
        });

        it('a fact\'s "Verify" / "Verify first": the preview of the fact\'s person; a couple\'s fact: the partner the research knows', () => {
            setBridgelessWindow(true);
            withTree();
            const f = forward();
            const u = { postResearchBridgeWrite: vi.fn(async () => null), verifyTipRedrawn: vi.fn() } as unknown as Record<string, Fn> & Methods;
            const view = (target: object, offer: object) => ({ target, offer: { eid: 'E0311', ...offer }, key: 'k' });
            verify.verifyOpenPreview.call(u, view({ personId: PID }, { verify: true }));
            verify.verifyOpenPreview.call(u, view({ partnershipId: UNION }, { prioritize: true }));
            expect(f.run.mock.calls).toEqual([
                [VERIFY_PERSON_ACTION, { personId: PID }, true],
                [VERIFY_PERSON_ACTION, { personId: WIFE, prioritize: true }, true],
            ]);
            expect(u.postResearchBridgeWrite).not.toHaveBeenCalled();
        });
    });

    describe('"Confirm against the scan" through the main window\'s bridge (fact-confirm)', () => {
        const ui = () => {
            const u: Record<string, unknown> = {
                postResearchBridgeWrite: vi.fn(async () => null), verifyRedraw: vi.fn(), verifyTipRedrawn: vi.fn(),
                showToast: vi.fn(), researchLoadNewer: vi.fn(async () => undefined),
            };
            u.factConfirmWrite = verify.factConfirmWrite;
            return u as Record<string, Fn> & Methods;
        };
        const view = () => ({ target: { personId: PID }, fact: 'birth', offer: { eid: 'E0311', scanViaBridge: true, undoViaBridge: true }, key: 'k-birth' });

        it('confirmed there: the fact shows it here as after this window\'s own write', async () => {
            setBridgelessWindow(true);
            withTree();
            const f = forward(true, { ok: true, fact: 'E0311', owner: 'P0001', head: 'c0ffee1', confirmed: '2026-11-20' });
            const u = ui();
            await verify.verifyConfirm.call(u, view(), true);
            expect(f.ask).toHaveBeenCalledWith(FACT_CONFIRM_ACTION, { eid: 'E0311', confirm: true }, expect.any(Number));
            expect(u.postResearchBridgeWrite).not.toHaveBeenCalled();
            expect(u.verifyRedraw).toHaveBeenCalledWith('undo');
            expect(u.showToast).not.toHaveBeenCalled();
        });

        it('refused there: the reason said here; changed meanwhile: the main window loads, not this one', async () => {
            setBridgelessWindow(true);
            withTree();
            forward(true, { ok: false, code: 'confirm.changed', status: 409, reason: '' });
            const u = ui();
            await verify.verifyConfirm.call(u, view(), true);
            expect(u.showToast).toHaveBeenCalledWith(expect.any(String), 8000, expect.objectContaining({ kind: 'verify-confirm' }));
            expect(u.researchLoadNewer).not.toHaveBeenCalled();
            expect(u.verifyRedraw).not.toHaveBeenCalled();
        });

        it('the main window closed: this window\'s own write, as before', async () => {
            setBridgelessWindow(true);
            withTree();
            const f = forward(false);
            const u = ui();
            await verify.verifyConfirm.call(u, view(), true);
            expect(f.ask).not.toHaveBeenCalled();
            expect(u.postResearchBridgeWrite).toHaveBeenCalledTimes(1);
        });

        it('the main window\'s answer is read strictly', () => {
            expect(readFactConfirmResult({ ok: true, fact: 'E1', owner: 'P1', head: 'h' })).toEqual({ ok: true, fact: 'E1', owner: 'P1', head: 'h' });
            expect(readFactConfirmResult({ ok: false, code: 'busy', status: 503, reason: 'later' })).toEqual({ ok: false, code: 'busy', status: 503, reason: 'later' });
            for (const bad of [null, 'ok', { ok: true, fact: 'E1' }, { ok: false, code: 'nope', status: 0, reason: '' }, { ok: false, code: 'busy', reason: '' }]) {
                expect(readFactConfirmResult(bad)).toBeNull();
            }
        });
    });

    describe('Revert through the main window\'s bridge (fact-revert)', () => {
        const ui = () => {
            const u: Record<string, unknown> = {
                researchRevertFact: vi.fn(async () => ({ kind: 'noBridge' })), refreshPersonReliability: vi.fn(), showToast: vi.fn(),
            };
            u.factRevertWrite = origin.factRevertWrite;
            return u as Record<string, Fn> & Methods;
        };

        it('reverted there: the notice here, as the main window says it', async () => {
            setBridgelessWindow(true);
            withTree();
            const f = forward(true, { kind: 'ok', head: 'beef002', parent: 'beef001', loaded: 'quiet' });
            const u = ui();
            await origin.runFactRevert.call(u, PID, 'birth');
            expect(f.ask).toHaveBeenCalledWith(FACT_REVERT_ACTION, { personId: PID, fact: 'birth' }, expect.any(Number));
            expect(u.researchRevertFact).not.toHaveBeenCalled();
            expect(u.showToast).toHaveBeenCalledWith(expect.any(String), 5000);
            expect(u.showToast.mock.calls[0][0]).not.toBe(strings.origin.already);
        });

        it('no answer from the main window: not reverted here (never "the research is not on this computer")', async () => {
            setBridgelessWindow(true);
            withTree();
            forward(true, null);
            const u = ui();
            expect(await origin.factRevertWrite.call(u, PID, 'birth', 'R0042', 'DATE')).toEqual({ kind: 'error', status: 0, code: 'network', reason: '' });
            expect(u.researchRevertFact).not.toHaveBeenCalled();
        });

        it('the main window closed, or the main window itself: its own revert', async () => {
            setBridgelessWindow(true);
            withTree();
            forward(false);
            const u = ui();
            await origin.factRevertWrite.call(u, PID, 'birth', 'R0042', 'DATE');
            expect(u.researchRevertFact).toHaveBeenCalledWith(PID, 'birth', 'R0042', 'DATE');
        });

        it('the main window reverts the earlier value its own tree holds', async () => {
            withTree();
            const u = { researchRevertFact: vi.fn(async () => ({ kind: 'ok', head: 'h2', parent: 'h1' })) } as unknown as Record<string, Fn> & Methods;
            expect(await origin.revertFactHere.call(u, PID, 'birth')).toEqual({ kind: 'ok', head: 'h2', parent: 'h1' });
            expect(u.researchRevertFact).toHaveBeenCalledWith(PID, 'birth', 'R0042', 'DATE');
            expect(await origin.revertFactHere.call(u, PID, 'death')).toMatchObject({ kind: 'error', code: 'invalid' });
            expect(u.researchRevertFact).toHaveBeenCalledTimes(1);
        });

        it('the main window\'s answer is read strictly', () => {
            expect(readRevertResult({ kind: 'writeHeld', computer: 'Studio', reason: 'sealed', held: { x: 1 } })).toEqual({ kind: 'writeHeld', reason: 'sealed', computer: 'Studio' });
            expect(readRevertResult({ kind: 'nothing', reason: '', loaded: 'later' })).toEqual({ kind: 'nothing', reason: '', loaded: 'later' });
            for (const bad of [null, { kind: 'ok', head: 'h' }, { kind: 'reverted' }, { kind: 'ok', head: 'h', parent: 'p', loaded: 'now' }]) {
                expect(readRevertResult(bad)).toBeNull();
            }
        });
    });

    describe('the main window runs them', () => {
        const deps = () => ({
            showVerifyPersonDialog: vi.fn(),
            factConfirmWrite: vi.fn(async () => ({ ok: true, fact: 'E1', owner: 'P1', head: 'h' })),
            revertFactHere: vi.fn(async () => ({ kind: 'nothing', reason: '' })),
        }) as unknown as Record<string, Fn>;

        it('verify-person, fact-confirm and fact-revert with valid arguments only', async () => {
            const d = deps();
            registerSatelliteResearchActions(d as never);
            expect(runMainResearchAction(VERIFY_PERSON_ACTION, { personId: PID, prioritize: true })).toEqual({ handled: true, result: true });
            expect(d.showVerifyPersonDialog).toHaveBeenCalledWith(PID, { prioritize: true });
            runMainResearchAction(VERIFY_PERSON_ACTION, { personId: PID });
            expect(d.showVerifyPersonDialog).toHaveBeenLastCalledWith(PID, {});
            const confirmed = runMainResearchAction(FACT_CONFIRM_ACTION, { eid: 'E1', confirm: false, txt: 'p' });
            expect(await confirmed.result).toEqual({ ok: true, fact: 'E1', owner: 'P1', head: 'h' });
            expect(d.factConfirmWrite).toHaveBeenCalledWith('E1', false, 'p');
            const reverted = runMainResearchAction(FACT_REVERT_ACTION, { personId: PID, fact: 'event:e3' });
            expect(await reverted.result).toEqual({ kind: 'nothing', reason: '' });
            expect(d.revertFactHere).toHaveBeenCalledWith(PID, 'event:e3');
            for (const [id, bad] of [
                [VERIFY_PERSON_ACTION, { personId: PID, prioritize: 'yes' }], [VERIFY_PERSON_ACTION, { personId: '' }],
                [VERIFY_PERSON_ACTION, { personId: PID, url: 'x' }], [FACT_CONFIRM_ACTION, { eid: 'E1' }],
                [FACT_CONFIRM_ACTION, { eid: '', confirm: true }], [FACT_CONFIRM_ACTION, { eid: 'E1', confirm: true, base: 'http://x' }],
                [FACT_REVERT_ACTION, { personId: PID }], [FACT_REVERT_ACTION, { personId: PID, fact: 'birth', ref: 'R1' }],
            ] as const) {
                expect(runMainResearchAction(id, bad)).toEqual({ handled: true });
            }
            expect(d.showVerifyPersonDialog).toHaveBeenCalledTimes(2);
            expect(d.factConfirmWrite).toHaveBeenCalledTimes(1);
            expect(d.revertFactHere).toHaveBeenCalledTimes(1);
        });
    });

    describe('the agent\'s mark and "Follow the research" follow the agent here', () => {
        const ui = () => ({ setLiveFollow: vi.fn(), renderLivePanel: vi.fn() }) as unknown as Record<string, Fn> & Methods;

        it('the research the main window follows: this window follows it (attached), no panel of its own', () => {
            setBridgelessWindow(true);
            mirror.session = { ended: false };
            const u = ui();
            research.showLiveResearchNow.call(u);
            expect(u.setLiveFollow).toHaveBeenCalledWith(true);
            expect(u.renderLivePanel).not.toHaveBeenCalled();
        });

        it('nothing followed there (or ended): nothing happens', () => {
            setBridgelessWindow(true);
            const u = ui();
            research.showLiveResearchNow.call(u);
            mirror.session = { ended: true };
            research.showLiveResearchNow.call(u);
            expect(u.setLiveFollow).not.toHaveBeenCalled();
        });
    });

    describe('the ⇄ of other trees', () => {
        it('is not matched in a window of its own (it would switch that window\'s tree)', async () => {
            vi.spyOn(SettingsManager, 'getCardSignals').mockReturnValue({ ...CARD_SIGNAL_DEFAULTS, crossTree: true });
            vi.spyOn(DataManager, 'isViewMode').mockReturnValue(false);
            const stamp = '2026-11-20T10:00:00.000Z';
            vi.spyOn(TreeManager, 'getVisibleTrees').mockReturnValue([
                { id: 't-a' as TreeId, name: 'Haberzettl', lastModifiedAt: stamp }, { id: 't-b' as TreeId, name: 'Zahradnik', lastModifiedAt: stamp },
            ] as never);
            vi.spyOn(TreeManager, 'getTreeData').mockImplementation(async () => treeData());
            const read = () => (TreeRenderer as unknown as { getAllTreesForCrossTreeMatching(): Promise<unknown> }).getAllTreesForCrossTreeMatching();
            setWindowRole('main');
            expect(await read()).not.toBeNull();
            setWindowRole('satellite');
            expect(await read()).toBeNull();
        });
    });
});
