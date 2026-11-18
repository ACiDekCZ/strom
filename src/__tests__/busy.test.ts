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

const { runBusy, setBusy, isBusy, prepareBusy, busyButtonHtml, BUSY_SHOW_MS, BUSY_MIN_MS, BUSY_DONE_MS } = await import('../ui/busy.js');
const { strings } = await import('../strings.js');

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
        text.appendChild(mark);
        btn.appendChild(text as unknown as Node);
        const job = deferred();
        const run = runBusy(btn, () => job.promise, { label: 'Opening…' });
        await vi.advanceTimersByTimeAsync(BUSY_SHOW_MS + 1);
        expect(btn.lastElementChild).toBe(mark);
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
        expect(css).toMatch(/\[data-busy="busy"\],[\s\S]{0,400}opacity: 1 !important/);
    });
});
