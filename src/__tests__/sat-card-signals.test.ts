/**
 * A card's research signals and "What the research knows" in a window of its
 * own (a tree's satellite, no bridge there): the card's "!", the person
 * menu's answer, "Awaiting action" and the story's fallback go to the main
 * window as `card-signal`; "What the research knows" (the signal, the
 * conflict badge, the question, facts waiting, the research edges, the edit
 * form's conflict panel) opens there as `person-research`, the main window
 * forward. With the main window closed, and in the main window itself, they
 * open as before. Invented data.
 */

import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';

import { setBridgelessWindow } from '../research-device.js';
import {
    CARD_SIGNAL_ACTION, clearMainResearchActions, readCardSignalArgs, runMainResearchAction, setSatResearchForward,
    type SatResearchForward,
} from '../windows/window-sat-research.js';
import { readOverviewAction } from '../windows/overview-window.js';
import { registerSatelliteResearchActions, type SatResearchMainDeps } from '../ui/sat-research-main.js';

type Fn = ReturnType<typeof vi.fn>;
type Methods = Record<string, (...args: unknown[]) => unknown>;

const PID = 'p-0412';

describe('card signals and "What the research knows" in a satellite window', () => {
    let card: Methods;
    let menu: Methods;
    let knows: Methods;
    let decide: Methods;
    let overview: Methods;

    beforeAll(async () => {
        ({ cardSignalsUiMethods: card } = await import('../ui/card-signals-ui.js') as unknown as { cardSignalsUiMethods: Methods });
        ({ contextMenuMethods: menu } = await import('../ui/context-menu.js') as unknown as { contextMenuMethods: Methods });
        ({ personResearchMethods: knows } = await import('../ui/person-research-ui.js') as unknown as { personResearchMethods: Methods });
        ({ conflictDecideMethods: decide } = await import('../ui/conflict-decide-ui.js') as unknown as { conflictDecideMethods: Methods });
        ({ overviewWindowMethods: overview } = await import('../ui/overview-window-ui.js') as unknown as { overviewWindowMethods: Methods });
    }, 60000);

    afterEach(() => {
        setBridgelessWindow(false);
        setSatResearchForward(null);
        clearMainResearchActions();
        vi.unstubAllGlobals();
    });

    function forward(open = true) {
        const f = { mainOpen: vi.fn(() => open), run: vi.fn(), ask: vi.fn(async () => null) };
        setSatResearchForward(f as SatResearchForward);
        return f;
    }

    /** The UI as the methods under test see it: the real ones of the test, the rest faked. */
    function ui(): Record<string, Fn> & Methods {
        const u: Record<string, unknown> = {
            hideContextMenu: vi.fn(),
            clearDialogStack: vi.fn(),
            showPersonWaiting: vi.fn(),
            personWaitingItems: vi.fn(() => []),
            openWaitingStoryCompare: vi.fn(() => false),
            showResearchWaiting: vi.fn(),
            showLiveResearchNow: vi.fn(),
            personOpenConflicts: vi.fn(() => [{ id: 'X0007' }]),
            runPersonListAction: vi.fn(() => false),
            waitingAnswerAction: vi.fn(() => null),
            closeResearchConflictPanel: vi.fn(),
            researchConflictCardState: vi.fn(() => null),
            researchConflictsShown: vi.fn(() => []),
            setResearchConflictCardState: vi.fn(),
            postDecide: vi.fn(async () => ({ ok: true })),
            personVerifyState: vi.fn(() => null),
        };
        u.cardSignalInMain = card.cardSignalInMain;
        u.openCardSignal = card.openCardSignal;
        u.answerPersonWaiting = card.answerPersonWaiting;
        u.openPersonResearchKnows = card.openPersonResearchKnows;
        u.runPersonMenuAction = menu.runPersonMenuAction;
        u.decideResearchConflict = decide.decideResearchConflict;
        // "What the research knows" itself: the real one (its forward), watched.
        u.showPersonResearchDialog = vi.fn(function (this: unknown, ...args: unknown[]) { return knows.showPersonResearchDialog.apply(this, args); });
        return u as Record<string, Fn> & Methods;
    }

    describe('a card\'s signal goes to the main window (card-signal)', () => {
        it('the card\'s "!" (answer): the main window opens it and comes forward; nothing opens here', () => {
            setBridgelessWindow(true);
            const f = forward();
            const u = ui();
            u.openCardSignal(PID, 'waiting');
            expect(f.run).toHaveBeenCalledWith(CARD_SIGNAL_ACTION, { personId: PID, signal: 'waiting' }, true);
            expect(u.showPersonWaiting).not.toHaveBeenCalled();
            expect(u.openWaitingStoryCompare).not.toHaveBeenCalled();
            expect(u.hideContextMenu).toHaveBeenCalled();
        });

        it('the conflict badge and the question: the main window\'s own card opens them', () => {
            setBridgelessWindow(true);
            const f = forward();
            const u = ui();
            u.openCardSignal(PID, 'conflict');
            u.openCardSignal(PID, 'question');
            expect(f.run.mock.calls).toEqual([
                [CARD_SIGNAL_ACTION, { personId: PID, signal: 'conflict' }, true],
                [CARD_SIGNAL_ACTION, { personId: PID, signal: 'question' }, true],
            ]);
            expect(u.showPersonResearchDialog).not.toHaveBeenCalled();
        });

        it('answering the person directly goes there too', () => {
            setBridgelessWindow(true);
            const f = forward();
            const u = ui();
            u.answerPersonWaiting(PID);
            expect(f.run).toHaveBeenCalledWith(CARD_SIGNAL_ACTION, { personId: PID, signal: 'waiting' }, true);
            expect(u.showPersonWaiting).not.toHaveBeenCalled();
        });

        it('the person menu\'s "Awaiting action" (touch) and the story\'s fallback', () => {
            setBridgelessWindow(true);
            const f = forward();
            const u = ui();
            u.runPersonMenuAction(PID, 'signal-waiting-list');
            u.runPersonMenuAction(PID, 'signal-story-compare');
            expect(f.run.mock.calls).toEqual([
                [CARD_SIGNAL_ACTION, { personId: PID, signal: 'waiting-list' }, true],
                [CARD_SIGNAL_ACTION, { personId: PID, signal: 'story-compare' }, true],
            ]);
            expect(u.showPersonWaiting).not.toHaveBeenCalled();
            expect(u.showResearchWaiting).not.toHaveBeenCalled();
        });

        it('a story\'s new version that opens here stays here (its buttons hand their links over)', () => {
            setBridgelessWindow(true);
            const f = forward();
            const u = ui();
            u.openWaitingStoryCompare.mockReturnValue(true);
            u.runPersonMenuAction(PID, 'signal-story-compare');
            expect(f.run).not.toHaveBeenCalled();
        });

        it('following the agent is not this forward\'s', () => {
            setBridgelessWindow(true);
            const f = forward();
            const u = ui();
            u.openCardSignal(PID, 'agent');
            expect(f.run).not.toHaveBeenCalled();
            expect(u.showLiveResearchNow).toHaveBeenCalled();
        });

        it('with the main window closed: opened here as before', () => {
            setBridgelessWindow(true);
            const f = forward(false);
            const u = ui();
            u.openCardSignal(PID, 'waiting');
            u.runPersonMenuAction(PID, 'signal-waiting-list');
            u.runPersonMenuAction(PID, 'signal-story-compare');
            expect(f.run).not.toHaveBeenCalled();
            expect(u.showPersonWaiting).toHaveBeenCalledTimes(2);
            expect(u.showResearchWaiting).toHaveBeenCalledTimes(1);
        });

        it('in the main window: opened here', () => {
            const f = forward();
            const u = ui();
            u.openCardSignal(PID, 'waiting');
            u.runPersonMenuAction(PID, 'signal-waiting-list');
            expect(f.run).not.toHaveBeenCalled();
            expect(u.showPersonWaiting).toHaveBeenCalledTimes(2);
        });
    });

    describe('"What the research knows" opens in the main window (person-research)', () => {
        it('the menu\'s signal, facts waiting and its research row: at the first conflict, else plain', () => {
            setBridgelessWindow(true);
            const f = forward();
            const u = ui();
            u.runPersonMenuAction(PID, 'signal-knows');
            u.runPersonMenuAction(PID, 'signal-verify-pending');
            u.runPersonMenuAction(PID, 'research-knows');
            expect(f.run.mock.calls).toEqual([
                ['person-research', { personId: PID, conflict: 'X0007' }, true],
                ['person-research', { personId: PID }, true],
                ['person-research', { personId: PID }, true],
            ]);
        });

        it('the question, a hypothesis\'s variant, the research edges: the main window\'s dialog at the same place', () => {
            setBridgelessWindow(true);
            const f = forward();
            const u = ui();
            u.showPersonResearchDialog(PID, { questions: true });
            u.showPersonResearchDialog(PID, { hypo: { id: 'H0003', variant: 'b' } });
            u.showPersonResearchDialog(PID, { edge: true });
            const sent = f.run.mock.calls.map(c => c[1]);
            expect(sent).toEqual([
                { personId: PID, questions: true },
                { personId: PID, hypo: 'H0003', variant: 'b' },
                { personId: PID, edge: true },
            ]);
            expect(f.run.mock.calls.every(c => c[0] === 'person-research' && c[2] === true)).toBe(true);
            // What the main window takes of them (its reading of the action), unchanged.
            for (const args of sent) expect(readOverviewAction('person-research', args)).toEqual({ action: 'person-research', args });
        });

        it('the edit form\'s conflict panel: deciding leads to the conflict\'s card in the main window, nothing written here', async () => {
            setBridgelessWindow(true);
            const f = forward();
            const u = ui();
            await u.decideResearchConflict(PID, 'X0007', 'research');
            expect(f.run).toHaveBeenCalledWith('person-research', { personId: PID, conflict: 'X0007' }, true);
            expect(u.closeResearchConflictPanel).toHaveBeenCalled();
            expect(u.postDecide).not.toHaveBeenCalled();
            expect(u.setResearchConflictCardState).not.toHaveBeenCalled();
        });

        it('with the main window closed, and in the main window: not forwarded', async () => {
            // The dialog here (nobody of that id in this test's tree: it draws nothing).
            vi.stubGlobal('document', { activeElement: null, body: {}, getElementById: () => null });
            setBridgelessWindow(true);
            const closed = forward(false);
            const u = ui();
            u.showPersonResearchDialog(PID, { questions: true });
            await u.decideResearchConflict(PID, 'X0007', 'research');
            expect(closed.run).not.toHaveBeenCalled();
            setBridgelessWindow(false);
            const main = forward();
            u.showPersonResearchDialog(PID, { questions: true });
            await u.decideResearchConflict(PID, 'X0007', 'research');
            expect(main.run).not.toHaveBeenCalled();
            expect(u.closeResearchConflictPanel).not.toHaveBeenCalled();
            expect(u.researchConflictsShown).toHaveBeenCalledTimes(4);
        });
    });

    describe('the main window runs them', () => {
        const deps = (): Record<keyof SatResearchMainDeps, Fn> => ({
            showPlacesManager: vi.fn(), openPlacesBulk: vi.fn(), showHousesWindow: vi.fn(),
            placesIdentifyHere: vi.fn(async () => null), placesLiveHere: vi.fn(async () => null),
            openCardSignal: vi.fn(), personWaitingItems: vi.fn(() => [{ id: 'w-3' }]), showPersonWaiting: vi.fn(),
            openWaitingStoryCompare: vi.fn(() => false), showResearchWaiting: vi.fn(),
        }) as never;

        it('card-signal: each signal as this window\'s own card opens it', () => {
            const d = deps();
            registerSatelliteResearchActions(d as never);
            for (const signal of ['waiting', 'conflict', 'question']) {
                expect(runMainResearchAction(CARD_SIGNAL_ACTION, { personId: PID, signal })).toEqual({ handled: true, result: true });
                expect(d.openCardSignal).toHaveBeenLastCalledWith(PID, signal);
            }
            runMainResearchAction(CARD_SIGNAL_ACTION, { personId: PID, signal: 'waiting-list' });
            expect(d.personWaitingItems).toHaveBeenCalledWith(PID);
            expect(d.showPersonWaiting).toHaveBeenCalledWith([{ id: 'w-3' }]);
            runMainResearchAction(CARD_SIGNAL_ACTION, { personId: PID, signal: 'story-compare' });
            expect(d.openWaitingStoryCompare).toHaveBeenCalledWith(PID);
            expect(d.showResearchWaiting).toHaveBeenCalledTimes(1);
            d.openWaitingStoryCompare.mockReturnValue(true);
            runMainResearchAction(CARD_SIGNAL_ACTION, { personId: PID, signal: 'story-compare' });
            expect(d.showResearchWaiting).toHaveBeenCalledTimes(1);
        });

        it('card-signal with valid arguments only', () => {
            const d = deps();
            registerSatelliteResearchActions(d as never);
            for (const bad of [null, 'waiting', [], { personId: PID }, { signal: 'waiting' }, { personId: '', signal: 'waiting' },
                { personId: 7, signal: 'waiting' }, { personId: PID, signal: 'agent' }, { personId: PID, signal: 'waiting', url: 'x' },
                { personId: 'p'.repeat(201), signal: 'waiting' }]) {
                expect(runMainResearchAction(CARD_SIGNAL_ACTION, bad)).toEqual({ handled: true });
            }
            expect(d.openCardSignal).not.toHaveBeenCalled();
            expect(d.showPersonWaiting).not.toHaveBeenCalled();
            expect(readCardSignalArgs({ personId: PID, signal: 'question' })).toEqual({ personId: PID, signal: 'question' });
        });

        it('person-research: the dialog at the question, a variant, the research edges', () => {
            const show = vi.fn();
            const u = { showPersonResearchDialog: show } as unknown as Methods;
            const run = (args: unknown) => {
                const a = readOverviewAction('person-research', args);
                expect(a).not.toBeNull();
                return overview.runOverviewWindowAction.call(u, a);
            };
            expect(run({ personId: PID, questions: true })).toBe(true);
            expect(show).toHaveBeenLastCalledWith(PID, { questions: true });
            run({ personId: PID, hypo: 'H0003', variant: 'b' });
            expect(show).toHaveBeenLastCalledWith(PID, { hypo: { id: 'H0003', variant: 'b' } });
            run({ personId: PID, edge: true });
            expect(show).toHaveBeenLastCalledWith(PID, { edge: true });
            run({ personId: PID, conflict: 'X0007' });
            expect(show).toHaveBeenLastCalledWith(PID, { conflict: 'X0007' });
            for (const bad of [{ personId: PID, edge: 'yes' }, { personId: PID, questions: 1 }, { personId: PID, hypo: 'H0003', variant: '' }]) {
                expect(readOverviewAction('person-research', bad)).toBeNull();
            }
        });
    });
});
