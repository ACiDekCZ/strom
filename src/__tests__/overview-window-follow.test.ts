/**
 * "Follow live" in the overview's own window (waiting buttons §1, §11.2): the element shows the state at once
 * (network work, no 120 ms wait), with the main window's step from its snapshot, until the main window answers;
 * a second ask meanwhile does nothing; the main window silent for 10 s: "The main Strom window does not
 * respond." with Try again under the element. A fixed clock.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { installMiniDom } from './helpers/mini-dom.js';

vi.mock('../ui/toast.js', () => ({
    showToast: () => ({ el: null, update: () => undefined, close: () => undefined }),
    showProgressToast: () => ({ el: null, update: () => undefined, done: () => undefined, fail: () => undefined, close: () => undefined }),
}));

const { followLiveFromWindow, resetWindowFollow } = await import('../ui/overview-window-follow.js');
const { overviewWindowOverrides } = await import('../ui/overview-window-view.js');
const { emptyOverviewExtras, OVERVIEW_STATE_VERSION } = await import('../windows/overview-window.js');
const { strings } = await import('../strings.js');
type OverviewResearchState = import('../windows/overview-window.js').OverviewResearchState;

let dom: ReturnType<typeof installMiniDom>;
let btn: HTMLElement;

function deferred<T = void>(): { promise: Promise<T>; resolve: (v: T) => void } {
    let resolve!: (v: T) => void;
    const promise = new Promise<T>((a) => { resolve = a; });
    return { promise, resolve };
}

beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-18T10:00:00Z'));
    dom = installMiniDom();
    const strip = dom.document.createElement('div');
    strip.className = 'research-overview__follow';
    dom.document.body.appendChild(strip);
    const b = dom.document.createElement('button');
    b.className = 'research-overview__follow-live';
    b.textContent = 'Follow live';
    strip.appendChild(b);
    btn = b as unknown as HTMLElement;
});

afterEach(() => {
    resetWindowFollow();
    vi.useRealTimers();
    dom.uninstall();
});

describe('"Follow live" in the overview\'s own window', () => {
    it('the state at once, the main window\'s step from its snapshot, until its answer', async () => {
        const answer = deferred<unknown>();
        let step: 'connect' | 'tree' | null = null;
        const ask = vi.fn(() => answer.promise);
        const run = followLiveFromWindow(btn, { ask, followStart: () => step });
        // Shown at once: no 120 ms wait for network work.
        expect(btn.getAttribute('aria-busy')).toBe('true');
        expect(btn.textContent).toContain(strings.busy.connectingResearch);
        expect(ask).toHaveBeenCalledTimes(1);
        step = 'connect';
        await vi.advanceTimersByTimeAsync(1000);
        step = 'tree';
        await vi.advanceTimersByTimeAsync(400);
        expect(btn.textContent).toContain(strings.busy.loadingTree);
        // Longer than the main window's 10 s: it works (its snapshot says the start), nothing said.
        await vi.advanceTimersByTimeAsync(15_000);
        expect(btn.getAttribute('aria-busy')).toBe('true');
        expect(dom.document.querySelector('.busy-msg')).toBeNull();
        // A second click meanwhile asks nothing more.
        expect(await followLiveFromWindow(btn, { ask, followStart: () => step })).toBe('busy');
        expect(ask).toHaveBeenCalledTimes(1);
        step = null;
        answer.resolve('on');
        await vi.advanceTimersByTimeAsync(400);
        expect(await run).toBe('on');
        expect(btn.getAttribute('aria-busy')).toBeNull();
        expect(dom.document.querySelector('.busy-msg')).toBeNull();
    });

    it('the main window silent for 10 s: its sentence with Try again, the element at rest', async () => {
        const ask = vi.fn(() => new Promise<unknown>(() => { /* never answers */ }));
        const run = followLiveFromWindow(btn, { ask, followStart: () => null });
        expect(btn.getAttribute('aria-busy')).toBe('true');
        await vi.advanceTimersByTimeAsync(9_800);
        expect(dom.document.querySelector('.busy-msg')).toBeNull();
        expect(btn.getAttribute('aria-busy')).toBe('true');
        await vi.advanceTimersByTimeAsync(600);
        await run;
        const msg = dom.document.querySelector('.busy-msg');
        expect(msg?.textContent).toContain(strings.busy.mainWindowSilent);
        expect(btn.getAttribute('aria-busy')).toBeNull();
        const retry = dom.document.querySelector('.busy-msg button.link');
        expect(retry?.textContent).toBe(strings.busy.retry);
        // Try again asks the main window once more.
        retry!.dispatchEvent(new Event('click'));
        expect(ask).toHaveBeenCalledTimes(2);
    });

    it('the main window closed (no answer at once): its sentence, nothing waited for', async () => {
        const run = followLiveFromWindow(btn, { ask: async () => null, followStart: () => null });
        await vi.advanceTimersByTimeAsync(400);
        await run;
        expect(dom.document.querySelector('.busy-msg')?.textContent).toContain(strings.busy.mainWindowSilent);
    });

    it('the window\'s "Follow live" asks the main window for its outcome (not a message without an answer)', async () => {
        const state: OverviewResearchState = {
            v: OVERVIEW_STATE_VERSION, at: 1000, treeId: null, treeName: '', researchId: 'R1', researchName: '', source: 'bridge',
            bridgeUp: true, session: null, viewing: null, extras: emptyOverviewExtras(),
        };
        const port = { send: vi.fn(), ask: vi.fn(async () => 'on' as unknown), focusMain: vi.fn() };
        const o = overviewWindowOverrides(port, () => state) as Record<string, (...a: unknown[]) => unknown>;
        const run = o.startFollowLive('overview', undefined, btn) as Promise<unknown>;
        expect(btn.getAttribute('aria-busy')).toBe('true');
        await vi.advanceTimersByTimeAsync(400);
        expect(await run).toBe('on');
        expect(port.ask).toHaveBeenCalledWith('follow-live', undefined, expect.any(Number));
        expect(port.send).not.toHaveBeenCalled();
        // A start the main window runs already (its snapshot): nothing asked.
        state.extras = { ...emptyOverviewExtras(), followStart: 'tree' };
        expect(await o.startFollowLive('overview', undefined, btn)).toBe('busy');
        expect(port.ask).toHaveBeenCalledTimes(1);
    });
});
