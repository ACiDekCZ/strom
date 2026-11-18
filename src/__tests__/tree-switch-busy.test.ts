/**
 * Switching trees in the one working state (src/ui/tree-switch-busy.ts, waiting buttons 2f): one switch at a
 * time, the waiting for the open tree's edits said with Cancel, no switch when they do not go within 15 s, the
 * edits locked meanwhile.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { installMiniDom, type MiniElement } from './helpers/mini-dom.js';

const progressCalls: Array<{ opts: Record<string, unknown>; closed: boolean }> = [];
vi.mock('../ui/toast.js', () => ({
    showToast: () => ({ el: null, update: () => undefined, close: () => undefined }),
    showProgressToast: (opts: Record<string, unknown>) => {
        const call = { opts, closed: false };
        progressCalls.push(call);
        return { el: null, update: () => undefined, done: () => undefined, fail: () => undefined, close: () => { call.closed = true; } };
    },
}));

const { runTreeSwitch, resetTreeSwitch, treeSwitchRunning, TREE_SWITCH_SEND_MS } = await import('../ui/tree-switch-busy.js');
const { TreeEditLock } = await import('../ui/tree-edit-lock.js');
const { BUSY_SHOW_MS } = await import('../ui/busy.js');
const { strings } = await import('../strings.js');

type Sent = 'none' | 'sent' | 'timeout' | 'cancelled';

let dom: ReturnType<typeof installMiniDom>;
let openRow: MiniElement;
let row: MiniElement;
let btn: HTMLElement;

beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-18T10:00:00Z'));
    dom = installMiniDom();
    openRow = dom.document.createElement('div');
    openRow.className = 'tree-manager-item active';
    row = dom.document.createElement('div');
    row.className = 'tree-manager-item';
    const actions = dom.document.createElement('div');
    actions.className = 'tree-manager-item-actions';
    const b = dom.document.createElement('button');
    b.className = 'tree-open-btn';
    b.textContent = 'Open';
    actions.appendChild(b);
    row.appendChild(actions);
    dom.document.body.appendChild(openRow);
    dom.document.body.appendChild(row);
    btn = b as unknown as HTMLElement;
    progressCalls.length = 0;
    TreeEditLock.reset();
});

afterEach(() => {
    resetTreeSwitch();
    TreeEditLock.reset();
    vi.useRealTimers();
    dom.uninstall();
});

const place = () => ({ sentenceIn: openRow as unknown as HTMLElement, cancelAfter: btn, msgIn: row as unknown as HTMLElement });

describe('runTreeSwitch', () => {
    it('switches once on a double activation, the edits locked meanwhile', async () => {
        let release!: () => void;
        const go = vi.fn(async () => undefined);
        const before = vi.fn(() => new Promise<{ sent: Sent }>(r => { release = () => r({ sent: 'none' }); }));
        const first = runTreeSwitch(btn, 'b', { before, go, retry: () => undefined }, place());
        const second = await runTreeSwitch(btn, 'b', { before, go, retry: () => undefined }, place());
        expect(second).toBe('busy');
        expect(treeSwitchRunning()).toBe('b');
        expect(TreeEditLock.held()).toBe('switch');
        expect(TreeEditLock.text()).toBe(strings.busy.editsWaitSwitch);
        release();
        await vi.advanceTimersByTimeAsync(500);
        expect(await first).toBe('switched');
        expect(before).toHaveBeenCalledTimes(1);
        expect(go).toHaveBeenCalledTimes(1);
        expect(TreeEditLock.held()).toBeNull();
        expect(treeSwitchRunning()).toBeNull();
    });

    it('says the wait for the edits with Cancel beside the element; Cancel: no switch', async () => {
        const go = vi.fn(async () => undefined);
        const before = ({ signal, onWait }: { signal: AbortSignal; onWait: () => void }) => new Promise<{ sent: Sent }>(r => {
            onWait();
            signal.addEventListener('abort', () => r({ sent: 'cancelled' }));
        });
        const run = runTreeSwitch(btn, 'b', { before, go, retry: () => undefined }, place());
        await vi.advanceTimersByTimeAsync(BUSY_SHOW_MS + 10);
        expect(btn.dataset.busy).toBe('busy');
        expect(btn.textContent).toContain(strings.busy.switching);
        const sentence = openRow.querySelector('.tree-switch-wait');
        expect(sentence?.textContent).toBe(strings.busy.beforeSwitchSend);
        const cancel = row.querySelector('.tree-switch-cancel');
        expect(cancel?.textContent).toBe(strings.buttons.cancel);
        cancel!.dispatchEvent(new Event('click'));
        await vi.advanceTimersByTimeAsync(500);
        expect(await run).toBe('cancelled');
        expect(go).not.toHaveBeenCalled();
        expect(openRow.querySelector('.tree-switch-wait')).toBeNull();
        expect(row.querySelector('.tree-switch-cancel')).toBeNull();
        expect(row.querySelector('.busy-msg')).toBeNull();
    });

    it('a quick send says nothing (no sentence before the state shows)', async () => {
        const before = ({ onWait }: { onWait: () => void }) => { onWait(); return new Promise<{ sent: Sent }>(r => setTimeout(() => r({ sent: 'sent' }), 50)); };
        const run = runTreeSwitch(btn, 'b', { before, go: async () => undefined, retry: () => undefined }, place());
        await vi.advanceTimersByTimeAsync(BUSY_SHOW_MS + 50);
        expect(openRow.querySelector('.tree-switch-wait')).toBeNull();
        expect(await run).toBe('switched');
    });

    it('no switch when the edits did not go within 15 s: the sentence in the row with Try again', async () => {
        const go = vi.fn(async () => undefined);
        const retry = vi.fn();
        const before = () => new Promise<{ sent: Sent }>(r => setTimeout(() => r({ sent: 'timeout' }), TREE_SWITCH_SEND_MS));
        const run = runTreeSwitch(btn, 'b', { before, go, retry }, place());
        await vi.advanceTimersByTimeAsync(TREE_SWITCH_SEND_MS + 500);
        expect(await run).toBe('timeout');
        expect(go).not.toHaveBeenCalled();
        const msg = row.querySelector('.busy-msg');
        expect(msg?.getAttribute('role')).toBe('alert');
        expect(msg?.textContent).toContain(strings.busy.switchNotSent(15));
        msg!.querySelector('.busy-msg__retry')!.dispatchEvent(new Event('click'));
        expect(retry).toHaveBeenCalledTimes(1);
        expect(TreeEditLock.held()).toBeNull();
    });

    it('an element gone with its menu: the wait in a progress toast with Cancel', async () => {
        const before = ({ signal, onWait }: { signal: AbortSignal; onWait: () => void }) => new Promise<{ sent: Sent }>(r => {
            onWait();
            signal.addEventListener('abort', () => r({ sent: 'cancelled' }));
        });
        const run = runTreeSwitch(null, 'b', { before, go: async () => undefined, retry: () => undefined });
        await vi.advanceTimersByTimeAsync(BUSY_SHOW_MS + 10);
        expect(progressCalls).toHaveLength(1);
        expect(progressCalls[0].opts.title).toBe(strings.busy.switching);
        (progressCalls[0].opts.cancel as () => void)();
        await vi.advanceTimersByTimeAsync(500);
        expect(await run).toBe('cancelled');
        expect(progressCalls[0].closed).toBe(true);
    });
});
