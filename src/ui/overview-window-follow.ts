/**
 * "Follow live" from the overview's own window (waiting buttons §1, §11.2): the main window starts following
 * (connecting to the research's bridge, then loading the tree). The element clicked here shows the state at once
 * and holds it until the main window answers how the start ended, with the step its snapshot says
 * (`extras.followStart`). The main window silent for 10 s (neither its answer nor a snapshot that the start
 * runs): "The main Strom window does not respond." under the element, with Try again. A dialog that says why
 * following cannot start is the main window's, as for its own click.
 */

import { strings } from '../strings.js';
import { BUSY_TIMEOUTS, isBusy, runBusy } from './busy.js';
import { OPEN_RELAYED_MS } from './research-open-busy.js';

/** What the window needs of its main window. */
export interface WindowFollowDeps {
    /** Ask the main window to start following; its outcome (null: none within `waitMs`, or the main window closed). */
    ask(waitMs: number): Promise<unknown>;
    /** The start as the main window's last snapshot says it (its step; null: none). */
    followStart(): 'connect' | 'tree' | null;
}

/** How often the snapshot is looked at while the main window works. */
export const WINDOW_FOLLOW_LOOK_MS = 200;

/** A start asked from this window and not answered yet (a second ask meanwhile does nothing). */
let asking = false;

function sleep(ms: number, signal: AbortSignal): Promise<void> {
    return new Promise(resolve => {
        if (signal.aborted) { resolve(); return; }
        const t = setTimeout(done, ms);
        function done(): void { clearTimeout(t); signal.removeEventListener('abort', done); resolve(); }
        signal.addEventListener('abort', done);
    });
}

/**
 * An action asked of the main window from this window while the element's state lasts (§11.2): its answer within
 * `waitMs`, the snapshot looked at meanwhile (`working`: the main window says the work runs, it heard the ask).
 * `silent`: nothing heard of the main window — neither its answer nor a snapshot of the work within 10 s, or no
 * answer at all (the main window closed). `aborted`: the state ended meanwhile.
 */
export async function askMainWindow(o: { ask(waitMs: number): Promise<unknown>; waitMs: number; working(): boolean; signal: AbortSignal }):
    Promise<{ answer: unknown; silent: boolean; aborted: boolean }> {
    let answered = false;
    let answer: unknown = null;
    const asked = o.ask(o.waitMs).then((v) => { answered = true; answer = v; });
    const silentAt = Date.now() + BUSY_TIMEOUTS.satellite;
    let heard = false;
    while (!answered && !o.signal.aborted) {
        if (o.working()) heard = true;
        else if (!heard && Date.now() >= silentAt) break;
        await Promise.race([asked, sleep(WINDOW_FOLLOW_LOOK_MS, o.signal)]);
    }
    return { answer, silent: !heard && (!answered || answer === null), aborted: o.signal.aborted };
}

/**
 * "Follow live" clicked in the overview's own window: the state on `el` (a stand-in's progress toast without
 * it) until the main window's answer. Gives that answer ('busy': a start runs already; null: none).
 */
export async function followLiveFromWindow(el: HTMLElement | null, deps: WindowFollowDeps): Promise<unknown> {
    if (asking || deps.followStart() !== null || el && isBusy(el)) return 'busy';
    asking = true;
    const target = el ?? document.createElement('span');
    let outcome: unknown = null;
    try {
        await runBusy(target, async (ctl) => {
            const got = await askMainWindow({
                ask: deps.ask, waitMs: BUSY_TIMEOUTS.tree, signal: ctl.signal,
                working: () => {
                    const step = deps.followStart();
                    if (step === 'tree') ctl.step(strings.busy.loadingTree);
                    return step !== null;
                },
            });
            outcome = got.answer;
            if (got.aborted) return;
            // Nothing heard of the main window: neither its answer nor a snapshot of the start (§11.2).
            if (got.silent) {
                ctl.end({
                    ok: false, kind: 'timeout', text: strings.busy.mainWindowSilent,
                    retry: () => { void followLiveFromWindow(target.isConnected ? target : null, deps); },
                });
                return;
            }
            // Its link handed over by the main window (no bridge known there): the state a moment, as for a link.
            if (outcome === 'link') await sleep(OPEN_RELAYED_MS, ctl.signal);
        }, { label: strings.busy.connectingResearch, atOnce: true, kind: 'tree', toastWhenGone: true });
    } finally {
        asking = false;
    }
    return outcome;
}

/** For the tests: no start asked. */
export function resetWindowFollow(): void {
    asking = false;
}
