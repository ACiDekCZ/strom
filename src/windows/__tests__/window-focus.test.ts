/**
 * A centre chosen in another window (spec 110 §2–§7): the ring at once, the
 * centre after the quiet and only for the newest choice; a run of choices is
 * one step of the history; following the agent only marks; a person hidden
 * or gone leaves the centre and says so.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WindowFocusController, WINDOW_FOCUS_DELAY_MS, VIEW_STEP_EVENT, type WindowFocusDeps, type WindowNotice } from '../window-focus.js';
import { wireMainSelection, type MainFocusDeps, type SelectionDeps, type WindowNoticeActions } from '../window-selection.js';
import type { SelectMeta, WindowRegistry } from '../window-registry.js';
import type { PersonId } from '../../types.js';

const P = (id: string) => id as PersonId;

function deps(over: Partial<WindowFocusDeps> = {}) {
    const state = { focus: P('home') as PersonId | null, agent: false, persons: new Set(['home', 'a', 'b', 'c', 'hid']), hiddenIds: new Set(['hid']) };
    const calls: string[] = [];
    const notices: Array<[WindowNotice, boolean]> = [];
    const d: WindowFocusDeps = {
        focusId: () => state.focus,
        exists: (id) => state.persons.has(id),
        hidden: (id) => state.hiddenIds.has(id),
        followingAgent: () => state.agent,
        ring: (id) => { calls.push(`ring:${id}`); },
        focus: (id, history) => { calls.push(`focus:${id}:${history}`); state.focus = id; },
        showNotice: (n, announce) => { notices.push([n, announce]); calls.push(`notice:${n.kind}`); },
        hideNotice: () => { calls.push('hide'); },
        ...over,
    };
    return { d, state, calls, notices };
}

beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-18T10:00:00Z'));
});
afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
});

describe('the centre from another window', () => {
    it('the ring at once; the centre after the quiet, once, to the newest choice (arrow keys over rows)', () => {
        const { d, calls, notices } = deps();
        const ctl = new WindowFocusController(d);
        ctl.take('a', 'w1', 1);
        expect(calls).toEqual(['ring:a']);
        vi.advanceTimersByTime(WINDOW_FOCUS_DELAY_MS - 50);
        ctl.take('b', 'w1', 2);
        vi.advanceTimersByTime(WINDOW_FOCUS_DELAY_MS - 50);
        ctl.take('c', 'w1', 3);
        expect(calls.filter(c => c.startsWith('focus'))).toEqual([]);
        vi.advanceTimersByTime(WINDOW_FOCUS_DELAY_MS);
        expect(calls.filter(c => c.startsWith('focus'))).toEqual(['focus:c:push']);
        expect(notices).toEqual([[{ kind: 'focus', previous: 'home' }, true]]);
    });

    it('an older choice than one already taken is dropped', () => {
        const { d, calls } = deps();
        const ctl = new WindowFocusController(d);
        ctl.take('b', 'w1', 5);
        ctl.take('a', 'w1', 4);
        vi.advanceTimersByTime(WINDOW_FOCUS_DELAY_MS);
        expect(calls.filter(c => c.startsWith('focus'))).toEqual(['focus:b:push']);
    });

    it('a run is one step of the history: the first centre pushes, the next ones replace; the words are read once', () => {
        const { d, calls, notices } = deps();
        const ctl = new WindowFocusController(d);
        for (const [id, seq] of [['a', 1], ['b', 2], ['c', 3]] as const) {
            ctl.take(id, 'w1', seq);
            vi.advanceTimersByTime(WINDOW_FOCUS_DELAY_MS);
        }
        expect(calls.filter(c => c.startsWith('focus'))).toEqual(['focus:a:push', 'focus:b:replace', 'focus:c:replace']);
        // "↶" names the centre before the run, every time.
        expect(notices.map(([n, said]) => [n.kind === 'focus' ? n.previous : null, said])).toEqual([['home', true], ['home', false], ['home', false]]);
        // A step of this window's own ends the run: the next choice pushes again.
        ctl.endRun();
        expect(calls.slice(-1)[0]).toBe('hide');
        ctl.take('a', 'w1', 4);
        vi.advanceTimersByTime(WINDOW_FOCUS_DELAY_MS);
        expect(calls.filter(c => c.startsWith('focus')).slice(-1)[0]).toBe('focus:a:push');
        expect(notices.slice(-1)[0]).toEqual([{ kind: 'focus', previous: 'c' }, true]);
    });

    it('another window\'s choice starts a run of its own; a window that stops sending focus ends its run', () => {
        const { d, calls } = deps();
        const ctl = new WindowFocusController(d);
        ctl.take('a', 'w1', 1);
        vi.advanceTimersByTime(WINDOW_FOCUS_DELAY_MS);
        ctl.take('b', 'w2', 1);
        vi.advanceTimersByTime(WINDOW_FOCUS_DELAY_MS);
        expect(calls.filter(c => c.startsWith('focus'))).toEqual(['focus:a:push', 'focus:b:push']);
        ctl.take('c', 'w2', 2);
        ctl.sourceEnded('w2');
        vi.advanceTimersByTime(WINDOW_FOCUS_DELAY_MS);
        expect(calls.filter(c => c.startsWith('focus'))).toEqual(['focus:a:push', 'focus:b:push']);
        expect(ctl.runSource).toBeNull();
    });

    it('the person already the centre: nothing', () => {
        const { d, calls, notices } = deps();
        const ctl = new WindowFocusController(d);
        ctl.take('home', 'w1', 1);
        vi.advanceTimersByTime(WINDOW_FOCUS_DELAY_MS);
        expect(calls).toEqual(['ring:home']);
        expect(notices).toEqual([]);
    });

    it('following the agent: the ring only, the centre stays; said once per run; nothing applied after following ends', () => {
        const { d, state, calls, notices } = deps();
        state.agent = true;
        const ctl = new WindowFocusController(d);
        ctl.take('a', 'w1', 1);
        vi.advanceTimersByTime(WINDOW_FOCUS_DELAY_MS);
        ctl.take('b', 'w1', 2);
        vi.advanceTimersByTime(WINDOW_FOCUS_DELAY_MS);
        expect(calls).toEqual(['ring:a', 'notice:agent', 'ring:b']);
        expect(notices.map(([n]) => n.kind)).toEqual(['agent']);
        state.agent = false;
        vi.advanceTimersByTime(WINDOW_FOCUS_DELAY_MS * 5);
        expect(state.focus).toBe('home');
    });

    it('a person hidden here: the centre stays, the notice without a name; one no longer in the tree: said', () => {
        const { d, state, calls, notices } = deps();
        const ctl = new WindowFocusController(d);
        ctl.take('hid', 'w1', 1);
        vi.advanceTimersByTime(WINDOW_FOCUS_DELAY_MS);
        ctl.take('gone', 'w1', 2);
        vi.advanceTimersByTime(WINDOW_FOCUS_DELAY_MS);
        expect(state.focus).toBe('home');
        expect(calls.filter(c => c.startsWith('ring'))).toEqual(['ring:null']);
        expect(notices.map(([n]) => n)).toEqual([{ kind: 'hidden' }, { kind: 'deleted' }]);
    });
});

describe('the main window\'s wiring', () => {
    function wire(mode = 'family', drawn: boolean | null = true) {
        let onSelect: ((id: string | null, origin: string, meta: SelectMeta) => void) | null = null;
        let onEnded: ((id: string) => void) | null = null;
        const registry = {
            list: () => [],
            announceSelection: () => {},
            onSelect: (cb: typeof onSelect) => { onSelect = cb; return () => { onSelect = null; }; },
            onSendEnded: (cb: typeof onEnded) => { onEnded = cb; return () => { onEnded = null; }; },
        } as unknown as WindowRegistry;
        const calls: string[] = [];
        let actions: WindowNoticeActions | null = null;
        let focus: PersonId = P('home');
        const mf: MainFocusDeps = {
            focusId: () => focus,
            exists: (id) => id !== 'gone',
            hidden: () => false,
            followingAgent: () => false,
            focus: (id, history) => {
                calls.push(`focus:${id}:${history}`);
                focus = id;
                // The renderer's own history step (pushed) is a view step: not the end of the run.
                if (history === 'push') window.dispatchEvent(new CustomEvent(VIEW_STEP_EVENT));
            },
            showNotice: (n, _said, a) => { actions = a; calls.push(`notice:${n.kind}`); },
            hideNotice: () => { calls.push('hide'); },
            drawn: () => drawn,
            back: () => { calls.push('back'); },
            goTo: (id) => { calls.push(`goto:${id}`); },
        };
        const sel: SelectionDeps = {
            viewMode: () => mode,
            setTableSelectionShare: () => {},
            tableSharedSelect: (id) => { calls.push(`table:${id}`); },
            setWindowSelected: (id) => { calls.push(`ring:${id}`); },
            glideTo: () => {},
            reveal: () => {},
            recenter: () => true,
            mainFocus: mf,
        };
        const stop = wireMainSelection(registry, sel);
        return { calls, stop, select: (id: string, meta: SelectMeta, origin = 'w1') => onSelect!(id, origin, meta), ended: (id: string) => onEnded!(id), actions: () => actions! };
    }

    beforeEach(() => {
        vi.stubGlobal('window', new EventTarget());
        vi.stubGlobal('CSS', { escape: (s: string) => s });
        vi.stubGlobal('document', { getElementById: () => null, querySelector: () => null });
    });

    it('focus: the centre after the quiet; a step of the window\'s own ends the run; ↶ goes back', () => {
        const w = wire();
        w.select('a', { intent: 'focus', seq: 1 });
        vi.advanceTimersByTime(WINDOW_FOCUS_DELAY_MS);
        expect(w.calls).toEqual(['ring:a', 'focus:a:push', 'ring:null', 'notice:focus']);
        window.dispatchEvent(new CustomEvent(VIEW_STEP_EVENT));
        expect(w.calls.slice(-1)[0]).toBe('hide');
        w.select('b', { intent: 'focus', seq: 2 });
        vi.advanceTimersByTime(WINDOW_FOCUS_DELAY_MS);
        expect(w.calls.filter(c => c.startsWith('focus'))).toEqual(['focus:a:push', 'focus:b:push']);
        w.actions().restore();
        expect(w.calls.slice(-2)).toEqual(['hide', 'back']);
        w.stop();
    });

    it('mark: only the ring; a person not drawn in the chart is said with "Go to"', () => {
        const drawnHere = wire('family', true);
        drawnHere.select('a', { intent: 'mark', seq: 1 });
        vi.advanceTimersByTime(WINDOW_FOCUS_DELAY_MS);
        expect(drawnHere.calls).toEqual(['ring:a']);
        drawnHere.stop();

        const absent = wire('fan', false);
        absent.select('a', { intent: 'mark', seq: 1 });
        vi.advanceTimersByTime(WINDOW_FOCUS_DELAY_MS);
        expect(absent.calls).toEqual(['ring:a', 'notice:not-in-view']);
        absent.actions().goTo(P('a'));
        expect(absent.calls.slice(-2)).toEqual(['hide', 'goto:a']);
        absent.stop();
    });

    it('main in the Table: the row with the ring at once, as a mark', () => {
        const w = wire('table', null);
        w.select('a', { intent: 'mark', seq: null });
        expect(w.calls).toEqual(['ring:a', 'table:a']);
        w.stop();
    });

    it('the window stops sending focus: its waiting choice goes and its notice with it', () => {
        const w = wire();
        w.select('a', { intent: 'focus', seq: 1 });
        vi.advanceTimersByTime(WINDOW_FOCUS_DELAY_MS);
        w.select('b', { intent: 'focus', seq: 2 });
        w.ended('w1');
        vi.advanceTimersByTime(WINDOW_FOCUS_DELAY_MS);
        expect(w.calls.filter(c => c.startsWith('focus'))).toEqual(['focus:a:push']);
        expect(w.calls.slice(-1)[0]).toBe('hide');
        w.stop();
    });
});
