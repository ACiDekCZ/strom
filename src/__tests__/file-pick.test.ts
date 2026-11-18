/**
 * Files picked in the system's dialog (waiting buttons §9, 9a–9c, src/ui/file-pick.ts): no state while the dialog
 * is open, only a guard against opening it twice; a choice called off (change without a file, the input's
 * `cancel`, the window's focus back without a file within 600 ms) gives the element back at once; reading a
 * chosen file is the element's working state with the file's name; a file that cannot be read ends in a sentence
 * at the element with "Choose another file"; `looksLikeGedcom` tells a GEDCOM from another text.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
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

const {
    openFilePicker, takePickOrigin, isPicking, readPickedFile, FileUnreadableError, looksLikeGedcom,
    whilePicking, PICK_FOCUS_CANCEL_MS, peopleText,
} = await import('../ui/file-pick.js');
const { isBusy, BUSY_SHOW_MS } = await import('../ui/busy.js');
const { strings } = await import('../strings.js');

let dom: ReturnType<typeof installMiniDom>;
let btn: HTMLElement;
let input: HTMLInputElement & { files: File[] | null; clicks: number };
let win: EventTarget;

beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-18T09:40:00Z'));
    dom = installMiniDom();
    // The window's focus coming back and the question on leaving need a window that takes events.
    win = new EventTarget();
    Object.assign(win, { matchMedia: () => ({ matches: false }) });
    (globalThis as Record<string, unknown>).window = win;
    const row = dom.document.createElement('div');
    row.className = 'acts';
    dom.document.body.appendChild(row);
    const b = dom.document.createElement('button');
    b.textContent = 'Import GEDCOM';
    row.appendChild(b);
    btn = b as unknown as HTMLElement;
    const i = dom.document.createElement('input') as MiniElement & { files: File[] | null; clicks: number; click: () => void };
    i.files = null;
    i.clicks = 0;
    i.click = () => { i.clicks++; };
    dom.document.body.appendChild(i);
    input = i as unknown as typeof input;
    toastCalls.length = 0;
    progressCalls.length = 0;
});

afterEach(() => {
    dom.uninstall();
    vi.useRealTimers();
});

/** A click on the element as the user's next try: true when it got through to its own handler. */
function clickThrough(el: HTMLElement): boolean {
    let reached = false;
    const onClick = (): void => { reached = true; };
    el.addEventListener('click', onClick);
    el.dispatchEvent(new Event('click', { cancelable: true }));
    el.removeEventListener('click', onClick);
    return reached;
}

describe('the system dialog open', () => {
    it('shows no state, only guards the element against a second dialog', () => {
        expect(openFilePicker(input, btn)).toBe(true);
        expect(input.clicks).toBe(1);
        expect(isPicking(btn)).toBe(true);
        expect(isBusy(btn)).toBe(false);
        vi.advanceTimersByTime(BUSY_SHOW_MS + 500);
        expect(btn.getAttribute('aria-busy')).toBeNull();
        expect(btn.dataset.busy).toBeUndefined();
        // A second press goes nowhere: no second dialog, the click does not reach the handler.
        expect(openFilePicker(input, btn)).toBe(false);
        expect(input.clicks).toBe(1);
        expect(clickThrough(btn)).toBe(false);
    });

    it('a change without a file gives the element back at once', () => {
        const cancelled = vi.fn();
        openFilePicker(input, btn, cancelled);
        input.dispatchEvent(new Event('change'));
        expect(cancelled).toHaveBeenCalledTimes(1);
        expect(isPicking(btn)).toBe(false);
        expect(clickThrough(btn)).toBe(true);
    });

    it("the input's cancel gives the element back at once", () => {
        const cancelled = vi.fn();
        openFilePicker(input, btn, cancelled);
        input.dispatchEvent(new Event('cancel'));
        expect(cancelled).toHaveBeenCalledTimes(1);
        expect(isPicking(btn)).toBe(false);
    });

    it("the window's focus back without a file calls the choice off after 600 ms", () => {
        const cancelled = vi.fn();
        openFilePicker(input, btn, cancelled);
        vi.advanceTimersByTime(0);
        win.dispatchEvent(new Event('focus'));
        vi.advanceTimersByTime(PICK_FOCUS_CANCEL_MS - 1);
        expect(isPicking(btn)).toBe(true);
        vi.advanceTimersByTime(1);
        expect(cancelled).toHaveBeenCalledTimes(1);
        expect(isPicking(btn)).toBe(false);
    });

    it('a file that comes with a late change is not called off by the focus', () => {
        const cancelled = vi.fn();
        openFilePicker(input, btn, cancelled);
        vi.advanceTimersByTime(0);
        win.dispatchEvent(new Event('focus'));
        vi.advanceTimersByTime(300);
        (input as unknown as { files: File[] }).files = [new File(['0 HEAD'], 'family.ged')];
        vi.advanceTimersByTime(PICK_FOCUS_CANCEL_MS);
        expect(cancelled).not.toHaveBeenCalled();
        // The change handler takes the element that opened the dialog.
        expect(takePickOrigin(input)).toBe(btn);
        expect(isPicking(btn)).toBe(false);
        expect(takePickOrigin(input)).toBeNull();
    });

    it('a promise dialog (Save as, the install prompt) guards the element only while it is open', async () => {
        let answer!: (v: string) => void;
        const open = vi.fn(() => new Promise<string>(r => { answer = r; }));
        const first = whilePicking(btn, open);
        expect(isPicking(btn)).toBe(true);
        expect(isBusy(btn)).toBe(false);
        expect(await whilePicking(btn, open)).toBeUndefined();
        expect(open).toHaveBeenCalledTimes(1);
        answer('family.json');
        expect(await first).toBe('family.json');
        expect(isPicking(btn)).toBe(false);
    });
});

describe('a chosen file read', () => {
    it("is the element's working state with the file's name, then the people found", async () => {
        let finish!: () => void;
        const done = readPickedFile(btn, { name: 'rodina-vrbecky.ged' }, async ctl => {
            await new Promise<void>(r => { finish = r; });
            ctl.people(2400);
            await new Promise<void>(r => setTimeout(r, 400));
            return 'tree';
        });
        expect(isBusy(btn)).toBe(true);
        await vi.advanceTimersByTimeAsync(BUSY_SHOW_MS);
        expect(btn.textContent).toContain(strings.busy.loadingFile('rodina-vrbecky.ged'));
        finish();
        await vi.advanceTimersByTimeAsync(10);
        expect(btn.textContent).toContain(peopleText(2400));
        await vi.advanceTimersByTimeAsync(2000);
        expect(await done).toBe('tree');
        expect(dom.document.querySelector('.busy-msg')).toBeNull();
    });

    it('a file that cannot be read ends in a sentence at the element with "Choose another file"', async () => {
        const again = vi.fn();
        const done = readPickedFile(btn, { name: 'notes.ged' }, async () => {
            throw new FileUnreadableError();
        }, again);
        await vi.advanceTimersByTimeAsync(BUSY_SHOW_MS + 500);
        expect(await done).toBeUndefined();
        const msg = dom.document.querySelector('.busy-msg');
        expect(msg?.textContent).toContain(strings.busy.fileUnreadable);
        const link = dom.document.querySelector('.busy-msg button.link');
        expect(link?.textContent).toBe(strings.busy.pickOther);
        link?.dispatchEvent(new Event('click'));
        expect(again).toHaveBeenCalledTimes(1);
        // No alert: nothing in a toast either.
        expect(toastCalls).toHaveLength(0);
    });

    it('without an element the failure is a toast with "Choose another file"', async () => {
        const again = vi.fn();
        const done = readPickedFile(null, { name: 'notes.ged' }, async () => { throw new FileUnreadableError(); }, again);
        await vi.advanceTimersByTimeAsync(10);
        expect(await done).toBeUndefined();
        expect(toastCalls).toHaveLength(1);
        expect(toastCalls[0].message).toBe(strings.busy.fileUnreadable);
        expect((toastCalls[0].opts.action as { label: string }).label).toBe(strings.busy.pickOther);
    });

    it('without an element a reading past 120 ms is a progress toast with the name', async () => {
        const done = readPickedFile(null, { name: 'family.json' }, async () => {
            await new Promise<void>(r => setTimeout(r, 500));
            return 1;
        });
        await vi.advanceTimersByTimeAsync(BUSY_SHOW_MS + 1);
        expect(progressCalls).toHaveLength(1);
        expect(progressCalls[0].title).toBe(strings.busy.loadingFile('family.json'));
        await vi.advanceTimersByTimeAsync(500);
        expect(await done).toBe(1);
    });
});

describe('looksLikeGedcom', () => {
    it('takes a header or a person or family record', () => {
        expect(looksLikeGedcom('0 HEAD\n1 CHAR UTF-8\n0 TRLR')).toBe(true);
        expect(looksLikeGedcom('﻿0 HEAD\r\n')).toBe(true);
        expect(looksLikeGedcom('0 @I1@ INDI\n1 NAME Jan /Vrbecký/')).toBe(true);
        expect(looksLikeGedcom('0 @F1@ FAM\n1 HUSB @I1@')).toBe(true);
    });

    it('refuses another text named .ged', () => {
        expect(looksLikeGedcom('')).toBe(false);
        expect(looksLikeGedcom('Hello, this is a letter.')).toBe(false);
        expect(looksLikeGedcom('{"persons":{}}')).toBe(false);
        expect(looksLikeGedcom('1 NAME Jan\n2 GIVN Jan')).toBe(false);
    });
});
