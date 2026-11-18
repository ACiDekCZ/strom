/**
 * The one working state (src/ui/busy.ts, waiting buttons §1, §10): locked at once, seen after 120 ms, at least
 * 300 ms once seen, ✓ for 2 s, a time limit by kind, an end without its element in a toast.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { installMiniDom, type MiniElement } from './helpers/mini-dom.js';

const toastCalls: Array<{ message: string; opts: Record<string, unknown> }> = [];
const progressCalls: Array<Record<string, unknown>> = [];
vi.mock('../ui/toast.js', () => ({
    showToast: (message: string, _d: number, opts: Record<string, unknown> = {}) => {
        toastCalls.push({ message, opts });
        return { el: null, update: () => undefined, close: () => undefined };
    },
    showProgressToast: (opts: Record<string, unknown>) => {
        progressCalls.push(opts);
        return { el: null, update: () => undefined, done: () => undefined, fail: () => undefined, close: () => undefined };
    },
}));

const { runBusy, setBusy, isBusy, prepareBusy, busyButtonHtml, clearBusyMessage, BUSY_SHOW_MS, BUSY_MIN_MS, BUSY_DONE_MS } = await import('../ui/busy.js');
const { strings } = await import('../strings.js');
const { openResearchBusy, resetOpenResearchBusy, OPEN_LATE_WATCH_MS, OPEN_REPEAT_MS } = await import('../ui/research-open-busy.js');
type LiveStatus = import('../research-link.js').LiveStatus;

let dom: ReturnType<typeof installMiniDom>;
let row: MiniElement;
let btn: HTMLElement;

function deferred<T = void>(): { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void } {
    let resolve!: (v: T) => void;
    let reject!: (e: unknown) => void;
    const promise = new Promise<T>((a, b) => { resolve = a; reject = b; });
    return { promise, resolve, reject };
}

beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-18T10:00:00Z'));
    dom = installMiniDom();
    row = dom.document.createElement('div');
    row.className = 'acts';
    const outer = dom.document.createElement('div');
    outer.className = 'item';
    outer.appendChild(row);
    dom.document.body.appendChild(outer);
    const b = dom.document.createElement('button');
    b.className = 'btn sm';
    b.textContent = 'Send';
    row.appendChild(b);
    btn = b as unknown as HTMLElement;
    toastCalls.length = 0;
    progressCalls.length = 0;
});

afterEach(() => {
    resetOpenResearchBusy();
    vi.useRealTimers();
    dom.uninstall();
});

describe('runBusy: when the state shows', () => {
    it('locks at once, shows nothing before 120 ms (a short action does not blink)', async () => {
        const job = deferred();
        const run = runBusy(btn, () => job.promise, { label: 'Sending…' });
        expect(btn.getAttribute('aria-disabled')).toBe('true');
        expect(btn.dataset.busy).toBe('lock');
        await vi.advanceTimersByTimeAsync(BUSY_SHOW_MS - 20);
        expect(btn.dataset.busy).toBe('lock');
        expect(btn.querySelector('.busy-spin')).toBeNull();
        job.resolve();
        await vi.advanceTimersByTimeAsync(0);
        await run;
        expect(btn.getAttribute('aria-disabled')).toBeNull();
        expect(btn.dataset.busy).toBeUndefined();
        expect(btn.textContent).toBe('Send');
    });

    it('after 120 ms: the spinner and the words, aria-busy, the width-keeping cell', async () => {
        const job = deferred();
        const run = runBusy(btn, () => job.promise, { label: 'Sending…' });
        await vi.advanceTimersByTimeAsync(BUSY_SHOW_MS + 1);
        expect(btn.dataset.busy).toBe('busy');
        expect(btn.getAttribute('aria-busy')).toBe('true');
        expect(btn.querySelector(':scope > .bl > .b-idle')?.textContent).toBe('Send');
        expect(btn.querySelector(':scope > .bl > .b-busy')?.textContent).toBe('Sending…');
        expect(btn.querySelector('.b-busy > .busy-spin')).not.toBeNull();
        job.resolve();
        await vi.advanceTimersByTimeAsync(BUSY_MIN_MS);
        await run;
        expect(btn.textContent).toBe('Send');
        expect(btn.getAttribute('aria-busy')).toBeNull();
    });

    it('a state once seen stays 300 ms at least', async () => {
        const job = deferred();
        const run = runBusy(btn, () => job.promise);
        await vi.advanceTimersByTimeAsync(BUSY_SHOW_MS + 30); // seen at 120, done at 150
        job.resolve();
        await vi.advanceTimersByTimeAsync(200);
        expect(btn.dataset.busy).toBe('busy');
        await vi.advanceTimersByTimeAsync(BUSY_MIN_MS);
        await run;
        expect(btn.dataset.busy).toBeUndefined();
    });

    it('heavy "now": seen at once', async () => {
        const job = deferred();
        const run = runBusy(btn, () => job.promise, { heavy: 'now' });
        expect(btn.dataset.busy).toBe('busy');
        job.resolve();
        await vi.advanceTimersByTimeAsync(BUSY_MIN_MS + 50);
        await run;
    });
});

describe('runBusy: the lock', () => {
    it('a second start while working does nothing', async () => {
        const job = deferred();
        const first = vi.fn(() => job.promise);
        const second = vi.fn(async () => 'again');
        const run = runBusy(btn, first);
        expect(isBusy(btn)).toBe(true);
        expect(await runBusy(btn, second)).toBeUndefined();
        expect(second).not.toHaveBeenCalled();
        job.resolve();
        await vi.advanceTimersByTimeAsync(BUSY_MIN_MS);
        await run;
        expect(isBusy(btn)).toBe(false);
    });

    it('a click or Enter on a locked element goes nowhere; Tab still moves on', async () => {
        const job = deferred();
        const run = runBusy(btn, () => job.promise);
        const clicked = vi.fn();
        const keyed = vi.fn();
        btn.addEventListener('click', clicked);
        btn.addEventListener('keydown', keyed);
        btn.dispatchEvent(new Event('click', { cancelable: true }));
        btn.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', cancelable: true }));
        btn.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab' }));
        expect(clicked).not.toHaveBeenCalled();
        expect(keyed).toHaveBeenCalledTimes(1);
        job.resolve();
        await vi.advanceTimersByTimeAsync(BUSY_MIN_MS);
        await run;
        btn.dispatchEvent(new Event('click'));
        expect(clicked).toHaveBeenCalledTimes(1);
    });

    it('setBusy on / off, the end after the minimum', async () => {
        setBusy(btn, true, { label: 'Saving…' });
        expect(isBusy(btn)).toBe(true);
        await vi.advanceTimersByTimeAsync(BUSY_SHOW_MS + 10);
        expect(btn.dataset.busy).toBe('busy');
        setBusy(btn, false);
        await vi.advanceTimersByTimeAsync(BUSY_MIN_MS);
        expect(isBusy(btn)).toBe(false);
        expect(btn.dataset.busy).toBeUndefined();
    });
});

describe('runBusy: the end', () => {
    it('✓ with its words for 2 s where the result is not seen otherwise', async () => {
                const run = runBusy(btn, async (ctl) => { await new Promise(r => setTimeout(r, 500)); ctl.end({ ok: true, done: 'Saved' }); });
        await vi.advanceTimersByTimeAsync(600);
        await run;
        expect(btn.dataset.busy).toBe('done');
        expect(btn.querySelector('.b-done')?.textContent).toBe('✓Saved');
        expect(isBusy(btn)).toBe(false);
        // the end came at 500 ms: the ✓ stands until 2500 ms
        await vi.advanceTimersByTimeAsync(BUSY_DONE_MS - 300);
        expect(btn.dataset.busy).toBe('done');
        await vi.advanceTimersByTimeAsync(400);
        expect(btn.dataset.busy).toBeUndefined();
        expect(btn.textContent).toBe('Send');
    });

    it('the time limit by kind: the terminal 10 s, the signal aborted, a sentence with Try again', async () => {
        let signal: AbortSignal | null = null;
        const run = runBusy(btn, (ctl) => { signal = ctl.signal; return new Promise(() => undefined); }, { kind: 'terminal' });
        await vi.advanceTimersByTimeAsync(9_900);
        expect(isBusy(btn)).toBe(true);
        await vi.advanceTimersByTimeAsync(200);
        expect(await run).toBeUndefined();
        expect(signal!.aborted).toBe(true);
        expect(isBusy(btn)).toBe(false);
        const msg = dom.document.querySelector('.busy-msg');
        expect(msg?.getAttribute('role')).toBe('alert');
        expect(msg?.textContent).toContain(strings.busy.errTimeout(10));
        // under the whole row of actions, not inside it
        expect(msg?.parentElement?.className).toBe('item');
    });

    it('an abort error is a time limit, other errors say what happened', async () => {
        const run = runBusy(btn, async () => { throw new DOMException('x', 'AbortError'); }, { kind: 'bridge', label: 'X' });
        await vi.advanceTimersByTimeAsync(10);
        await run;
        expect(dom.document.querySelector('.busy-msg')?.textContent).toContain(strings.busy.errTimeout(15));
        const again = runBusy(btn, async () => { throw new TypeError('Failed to fetch'); });
        // a new try takes the old sentence away
        expect(dom.document.querySelector('.busy-msg')).toBeNull();
        await vi.advanceTimersByTimeAsync(10);
        await again;
        expect(dom.document.querySelector('.busy-msg')?.textContent).toContain(strings.busy.errOffline);
    });

    it('Try again in the sentence runs its retry', async () => {
        const retry = vi.fn();
        const run = runBusy(btn, async (ctl) => { ctl.end({ ok: false, kind: 'error', text: 'No.', retry }); });
        await vi.advanceTimersByTimeAsync(10);
        await run;
        const b = dom.document.querySelector('.busy-msg button.link');
        expect(b?.textContent).toBe(strings.busy.retry);
        b!.dispatchEvent(new Event('click'));
        expect(retry).toHaveBeenCalledTimes(1);
        expect(dom.document.querySelector('.busy-msg')).toBeNull();
    });

    it('the element gone before the end: the end comes as a toast that stays', async () => {
        const job = deferred();
        const run = runBusy(btn, async (ctl) => { await job.promise; ctl.end({ ok: false, kind: 'error', text: 'Not written.' }); });
        await vi.advanceTimersByTimeAsync(200);
        row.remove();
        job.resolve();
        await vi.advanceTimersByTimeAsync(BUSY_MIN_MS);
        await run;
        expect(toastCalls).toHaveLength(1);
        expect(toastCalls[0].message).toBe('Not written.');
        expect(toastCalls[0].opts.alert).toBe(true);
        expect(toastCalls[0].opts.closable).toBe(true);
    });

    it('the element gone while working: its row takes the state (rowOf)', async () => {
        const job = deferred();
        const menu = dom.document.createElement('div');
        dom.document.body.appendChild(menu);
        menu.appendChild(btn as unknown as MiniElement);
        const run = runBusy(btn, () => job.promise, { rowOf: row as unknown as HTMLElement });
        menu.remove();
        await vi.advanceTimersByTimeAsync(BUSY_SHOW_MS + 10);
        expect(row.getAttribute('aria-busy')).toBe('true');
        expect(row.querySelector('.busy-slot .busy-spin')).not.toBeNull();
        job.resolve();
        await vi.advanceTimersByTimeAsync(BUSY_MIN_MS);
        await run;
        expect(row.getAttribute('aria-busy')).toBeNull();
        expect(row.querySelector('.busy-slot')).toBeNull();
    });
});

describe('the structure', () => {
    it('the research\'s mark stays outside the cell, last', async () => {
        btn.replaceChildren();
        const text = dom.document.createElement('span');
        text.className = 'research-open-text';
        text.textContent = 'Open the research';
        const mark = dom.document.createElement('span');
        mark.className = 'research-open-mark';
        mark.textContent = ', opens in the research';
        text.appendChild(mark);
        btn.appendChild(text as unknown as Node);
        const job = deferred();
        const run = runBusy(btn, () => job.promise, { label: 'Opening…' });
        await vi.advanceTimersByTimeAsync(BUSY_SHOW_MS + 1);
        expect(btn.lastElementChild).toBe(mark);
        // Its name at work keeps the mark's words (§1.2: the name stays the one at rest).
        expect(btn.getAttribute('aria-label')).toBe('Open the research, opens in the research');
        expect(btn.querySelector('.bl .research-open-mark')).toBeNull();
        job.resolve();
        await vi.advanceTimersByTimeAsync(BUSY_MIN_MS);
        await run;
        expect(mark.parentElement).toBe(text);
    });

    it('prepareBusy keeps the structure; busyButtonHtml draws it', () => {
        prepareBusy(btn, 'Sending…', 'Sent');
        expect(btn.dataset.busy).toBe('idle');
        expect(btn.querySelector(':scope > .bl > .b-done')?.textContent).toBe('✓Sent');
        const html = busyButtonHtml('Send', 'Sending…', 'Sent');
        expect(html).toContain('<span class="b-idle">Send</span>');
        expect(html).toContain('class="b-busy" aria-hidden="true"');
    });

    it('a cell prepared with its own words keeps them over the action\'s sentence (§1.2: its width set at rest)', async () => {
        btn.textContent = 'Validation details';
        prepareBusy(btn, 'Checking…', undefined, { own: true });
        const job = deferred();
        const run = runBusy(btn, () => job.promise, { label: 'Checking 5,154 people…' });
        await vi.advanceTimersByTimeAsync(BUSY_SHOW_MS + 1);
        expect(btn.dataset.busy).toBe('busy');
        expect(btn.querySelector(':scope > .bl > .b-busy')?.textContent).toBe('Checking…');
        job.resolve();
        await vi.advanceTimersByTimeAsync(BUSY_MIN_MS);
        await run;
        expect(btn.querySelector(':scope > .bl > .b-busy')?.textContent).toBe('Checking…');
    });

    it('a working element keeps its name: its idle words held as aria-label until rest', async () => {
        const job = deferred();
        const run = runBusy(btn, () => job.promise, { label: 'Sending…' });
        await vi.advanceTimersByTimeAsync(BUSY_SHOW_MS + 1);
        expect(btn.getAttribute('aria-label')).toBe('Send');
        job.resolve();
        await vi.advanceTimersByTimeAsync(BUSY_MIN_MS);
        await run;
        expect(btn.getAttribute('aria-label')).toBeNull();
    });

    it('wordsIn: the words stand in that line, the element shows its spinner alone, the line back at rest', async () => {
        btn.textContent = 'Couples';
        prepareBusy(btn, '', undefined, { own: true });
        const hint = dom.document.createElement('p');
        hint.textContent = 'Each couple a tree.';
        row.appendChild(hint);
        const job = deferred();
        const run = runBusy(btn, () => job.promise, { label: 'Finding families…', wordsIn: hint as unknown as HTMLElement });
        await vi.advanceTimersByTimeAsync(BUSY_SHOW_MS + 1);
        expect(btn.querySelector(':scope > .bl > .b-busy')?.textContent).toBe('');
        expect(btn.querySelector('.b-busy > .busy-spin')).not.toBeNull();
        expect(hint.textContent).toBe('Finding families…');
        job.resolve();
        await vi.advanceTimersByTimeAsync(BUSY_MIN_MS);
        await run;
        expect(hint.textContent).toBe('Each couple a tree.');
    });

    it('a link keeps its text, the spinner after it', async () => {
        const a = dom.document.createElement('button');
        a.className = 'link';
        a.textContent = 'Discuss';
        row.appendChild(a);
        const job = deferred();
        const run = runBusy(a as unknown as HTMLElement, () => job.promise);
        await vi.advanceTimersByTimeAsync(BUSY_SHOW_MS + 1);
        expect(a.querySelector('.bl')).toBeNull();
        expect(a.querySelector(':scope > .busy-slot > .busy-spin.s12')).not.toBeNull();
        job.resolve();
        await vi.advanceTimersByTimeAsync(BUSY_MIN_MS);
        await run;
        expect(a.querySelector('.busy-slot')).toBeNull();
    });

    it('reduced motion: the spinner stands still as three dots; a working element is never dimmed', () => {
        const css = readFileSync(new URL('../../index.html', import.meta.url), 'utf-8');
        const rm = /@media \(prefers-reduced-motion: reduce\) \{\s*\.busy-spin \{([^}]*)\}/.exec(css);
        expect(rm).not.toBeNull();
        expect(rm![1]).toContain('animation: none');
        expect(rm![1]).toContain('radial-gradient');
        // The rule over the dimming: every working kind of element, its working attributes, never faded.
        expect(css).toMatch(/\)\[data-busy="busy"\],[^{]*\[aria-busy="true"\] \{\s*opacity: 1 !important/);
    });
});

// ==================== A LINK INTO THE RESEARCH (§3.1) ====================

const ID = '0f8fad5b-d9cb-469f-a165-70867728950e';
const LINK = 'strom-research://open?tree=R1';

/** A bridge's status with just what the proof reads. */
function status(p: { features?: string[] | null; handoffs?: string[]; sessions?: number; working?: Array<{ who: string; since: string }> } = {}): LiveStatus {
    return {
        treeId: 'R1', features: p.features === undefined ? ['handoffs'] : p.features,
        ...(p.handoffs ? { handoffs: p.handoffs } : {}),
        ...(p.sessions !== undefined ? { busy: { sessions: p.sessions, runs: 0 } } : {}),
        working: (p.working ?? []).map(w => ({ ...w, task: '' })),
    } as unknown as LiveStatus;
}

/** The bridge of a test: its answers set by the test, the links handed over recorded. */
function bridge(opts: { down?: boolean; before?: LiveStatus | null } = {}) {
    let answer: LiveStatus | null = status({ handoffs: [] });
    const handed: Array<{ url: string; handoff: string | null }> = [];
    const asks = { n: 0 };
    const deps = {
        handOver: (url: string, handoff: string | null) => { handed.push({ url, handoff }); },
        ask: async () => { asks.n++; return answer; },
        statusNow: () => opts.before ?? null,
        bridgeDown: () => !!opts.down,
        newId: () => ID,
    };
    return { deps, handed, asks, answer: (st: LiveStatus | null) => { answer = st; } };
}

const message = (): MiniElement | null => dom.document.querySelector('.busy-msg');

describe('openResearchBusy: a link into the research', () => {
    it('"Opening the research…" on the element until the research says the link\'s handoff', async () => {
        const b = bridge();
        const run = openResearchBusy(btn, LINK, {}, b.deps);
        expect(b.handed).toEqual([{ url: LINK, handoff: ID }]);
        await vi.advanceTimersByTimeAsync(BUSY_SHOW_MS + 1);
        expect(btn.querySelector('.b-busy')?.textContent).toBe(strings.busy.openingResearch);
        await vi.advanceTimersByTimeAsync(2_000);
        expect(isBusy(btn)).toBe(true);
        b.answer(status({ handoffs: ['11111111-2222-4333-8444-555555555555', ID] }));
        await vi.advanceTimersByTimeAsync(1_000 + BUSY_MIN_MS);
        expect(await run).toBe('opened');
        expect(isBusy(btn)).toBe(false);
        expect(message()).toBeNull();
        expect(btn.textContent).toBe('Send');
    });

    it('a second click while it waits hands nothing over again', async () => {
        const b = bridge();
        void openResearchBusy(btn, LINK, {}, b.deps);
        expect(await openResearchBusy(btn, LINK, {}, b.deps)).toBe('busy');
        // another element drawn for the same link (a list drawn again) neither
        const other = dom.document.createElement('button') as unknown as HTMLElement;
        expect(await openResearchBusy(other, LINK, {}, b.deps)).toBe('busy');
        expect(b.handed).toHaveLength(1);
        // seconds later another element starting it again is a new start (the card's ! clicked once more)
        await vi.advanceTimersByTimeAsync(OPEN_REPEAT_MS + 1);
        expect(await openResearchBusy(btn, LINK, {}, b.deps)).toBe('busy');
        void openResearchBusy(other, LINK, {}, b.deps);
        expect(b.handed).toHaveLength(2);
    });

    it('the same link started again from a new element half a second later is a new start (another dialog\'s button)', async () => {
        const b = bridge();
        void openResearchBusy(btn, LINK, {}, b.deps);
        // the dialog of the first click closed; the next dialog's button, a step of the person later
        btn.remove();
        await vi.advanceTimersByTimeAsync(500);
        const nb = dom.document.createElement('button');
        dom.document.body.appendChild(nb);
        void openResearchBusy(nb as unknown as HTMLElement, LINK, {}, b.deps);
        expect(b.handed).toHaveLength(2);
        // still a double activation within a double click's time
        const third = dom.document.createElement('button') as unknown as HTMLElement;
        void openResearchBusy(third, LINK, {}, b.deps);
        expect(b.handed).toHaveLength(2);
    });

    it('an older research (no handoffs): a new session is the proof', async () => {
        const b = bridge({ before: status({ features: null, sessions: 0 }) });
        b.answer(status({ features: null, sessions: 0 }));
        const run = openResearchBusy(btn, LINK, {}, b.deps);
        await vi.advanceTimersByTimeAsync(3_000);
        expect(isBusy(btn)).toBe(true);
        b.answer(status({ features: null, sessions: 1 }));
        await vi.advanceTimersByTimeAsync(1_000 + BUSY_MIN_MS);
        expect(await run).toBe('opened');
        expect(message()).toBeNull();
    });

    it('an older research whose bridge says the same session\'s start a little later each time: no proof, the sentence at the limit', async () => {
        // A stand-in bridge that says `since` relative to its own clock: the same session, not a new one.
        const at = (s: number) => new Date(Date.UTC(2026, 10, 18, 9, 44, s)).toISOString();
        const b = bridge({ before: status({ features: null, sessions: 1, working: [{ who: 'agent', since: at(0) }] }) });
        b.answer(status({ features: null, sessions: 1, working: [{ who: 'agent', since: at(3) }] }));
        const run = openResearchBusy(btn, LINK, {}, b.deps);
        await vi.advanceTimersByTimeAsync(10_500);
        expect(await run).toBe('limit');
        expect(message()?.textContent).toContain(strings.busy.notOpened);
        // a session started later (another one of the same agent) still proves it
        resetOpenResearchBusy();
        clearBusyMessage(btn);
        const again = openResearchBusy(btn, LINK, {}, b.deps);
        await vi.advanceTimersByTimeAsync(1_500);
        b.answer(status({ features: null, sessions: 1, working: [{ who: 'agent', since: at(3) }, { who: 'agent', since: new Date(Date.UTC(2026, 10, 18, 10, 0, 0)).toISOString() }] }));
        await vi.advanceTimersByTimeAsync(1_000 + BUSY_MIN_MS);
        expect(await again).toBe('opened');
    });

    it('no proof in 10 s: the element at rest, a neutral sentence with Try again and the hint under it', async () => {
        const b = bridge();
        const run = openResearchBusy(btn, LINK, {}, b.deps);
        await vi.advanceTimersByTimeAsync(9_500);
        expect(isBusy(btn)).toBe(true);
        expect(message()).toBeNull();
        await vi.advanceTimersByTimeAsync(1_000);
        expect(await run).toBe('limit');
        expect(isBusy(btn)).toBe(false);
        const msg = message();
        expect(msg?.getAttribute('role')).toBe('status');
        expect(msg?.classList.contains('is-err')).toBe(false);
        expect(msg?.textContent).toContain(strings.busy.notOpened);
        expect(msg?.textContent).toContain(strings.busy.notOpenedHint);
        expect(b.asks.n).toBeGreaterThanOrEqual(8);
        // Try again hands the link over once more
        msg!.querySelector('button.link')!.dispatchEvent(new Event('click'));
        expect(b.handed).toHaveLength(2);
    });

    it('a proof coming after the limit takes the sentence away by itself', async () => {
        const b = bridge();
        const run = openResearchBusy(btn, LINK, {}, b.deps);
        await vi.advanceTimersByTimeAsync(10_500);
        await run;
        expect(message()?.textContent).toContain(strings.busy.notOpened);
        await vi.advanceTimersByTimeAsync(20_000);
        expect(message()).not.toBeNull();
        b.answer(status({ handoffs: [ID] }));
        await vi.advanceTimersByTimeAsync(2_500);
        expect(message()).toBeNull();
    });

    it('the late watch ends after a minute', async () => {
        const b = bridge();
        const run = openResearchBusy(btn, LINK, {}, b.deps);
        await vi.advanceTimersByTimeAsync(10_500);
        await run;
        await vi.advanceTimersByTimeAsync(OPEN_LATE_WATCH_MS + 5_000);
        const asked = b.asks.n;
        b.answer(status({ handoffs: [ID] }));
        await vi.advanceTimersByTimeAsync(10_000);
        expect(b.asks.n).toBe(asked);
        expect(message()).not.toBeNull();
    });

    it('a bridge known down: the link handed over and the sentence at once', async () => {
        const b = bridge({ down: true });
        const run = openResearchBusy(btn, LINK, {}, b.deps);
        await vi.advanceTimersByTimeAsync(10);
        expect(await run).toBe('down');
        expect(b.handed).toHaveLength(1);
        expect(btn.dataset.busy).toBeUndefined();
        expect(message()?.textContent).toContain(strings.busy.notOpened);
    });

    it('the agent\'s work says "Opening the agent…"; a link without a terminal "Loading…" and no word of a terminal', async () => {
        const b = bridge();
        void openResearchBusy(btn, 'strom-research://chat?tree=R1', {}, b.deps);
        await vi.advanceTimersByTimeAsync(BUSY_SHOW_MS + 1);
        expect(btn.querySelector('.b-busy')?.textContent).toBe(strings.busy.openingAgent);
        b.answer(status({ handoffs: [ID] }));
        await vi.advanceTimersByTimeAsync(1_500);
        expect(isBusy(btn)).toBe(false);
        b.answer(status({ handoffs: [] }));
        const quiet = dom.document.createElement('button');
        quiet.textContent = 'Excerpt';
        row.appendChild(quiet);
        const run = openResearchBusy(quiet as unknown as HTMLElement, 'strom-research://excerpt?tree=R1&source=S1', {}, b.deps);
        await vi.advanceTimersByTimeAsync(BUSY_SHOW_MS + 1);
        expect(quiet.querySelector('.b-busy')?.textContent).toBe(strings.busy.generic);
        await vi.advanceTimersByTimeAsync(10_500);
        await run;
        const texts = dom.document.querySelectorAll('.busy-msg').map(m => m.textContent);
        expect(texts.some(t => t.includes(strings.research.openingQuietHint))).toBe(true);
        expect(texts.some(t => t.includes(strings.busy.notOpened))).toBe(false);
    });

    it('a new research from the app\'s tree is never reported: no handoff, no asks, only the limit', async () => {
        const b = bridge();
        const run = openResearchBusy(btn, 'strom-research://new?app=1', {}, b.deps);
        expect(b.handed[0].handoff).toBeNull();
        await vi.advanceTimersByTimeAsync(10_500);
        expect(await run).toBe('limit');
        expect(b.asks.n).toBe(0);
        expect(message()?.textContent).toContain(strings.busy.notOpened);
    });

    it('without an element: the state in a toast, the sentence in a toast', async () => {
        const b = bridge();
        const run = openResearchBusy(null, LINK, {}, b.deps);
        await vi.advanceTimersByTimeAsync(BUSY_SHOW_MS + 1);
        expect(progressCalls).toHaveLength(1);
        expect(progressCalls[0].title).toBe(strings.busy.openingResearch);
        await vi.advanceTimersByTimeAsync(10_500);
        await run;
        expect(toastCalls[toastCalls.length - 1]?.message).toContain(strings.busy.notOpened);
        expect(toastCalls[toastCalls.length - 1]?.opts.alert).toBe(false);
    });
});
