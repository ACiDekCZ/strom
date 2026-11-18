/**
 * A menu item that reads before its action (waiting buttons §4, 4c, src/ui/menu-load.ts): the menu holds, the
 * item says it works (aria-busy, its spinner past 120 ms), the others wait; closing the menu cancels the
 * reading (its signal aborted); past 30 s the reading stops and a sentence under the item says so.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { installMiniDom, type MiniElement } from './helpers/mini-dom.js';

const { startMenuLoad, MENU_LOAD_LIMIT_MS } = await import('../ui/menu-load.js');
const { strings } = await import('../strings.js');

let dom: ReturnType<typeof installMiniDom>;
let menu: MiniElement;
let items: MiniElement[];

beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-18T09:30:00Z'));
    dom = installMiniDom();
    menu = dom.document.createElement('div');
    menu.setAttribute('role', 'menu');
    dom.document.body.appendChild(menu);
    items = ['select', 'assign', 'hide'].map(id => {
        const b = dom.document.createElement('button');
        b.setAttribute('role', 'menuitem');
        b.dataset.action = id;
        b.textContent = id;
        menu.appendChild(b);
        return b;
    });
    items[2].setAttribute('aria-disabled', 'true');
});
afterEach(() => {
    dom.uninstall();
    vi.useRealTimers();
});

const h = (e: MiniElement) => e as unknown as HTMLElement;

describe('a menu item reading before its action', () => {
    it('holds the menu: the item busy, its spinner after 120 ms, the others waiting; done puts them back', () => {
        const load = startMenuLoad(h(menu), h(items[0]));
        expect(items[0].getAttribute('aria-busy')).toBe('true');
        expect(items[1].getAttribute('aria-disabled')).toBe('true');
        expect(items[0].querySelector('.busy-spin')).toBeNull();
        vi.advanceTimersByTime(120);
        expect(items[0].querySelector('.busy-slot .busy-spin')).not.toBeNull();
        expect(items[0].textContent).toBe('select');
        load.done();
        expect(items[0].hasAttribute('aria-busy')).toBe(false);
        expect(items[0].querySelector('.busy-spin')).toBeNull();
        expect(items[1].hasAttribute('aria-disabled')).toBe(false);
        // An item unavailable before stays so.
        expect(items[2].getAttribute('aria-disabled')).toBe('true');
        expect(load.signal.aborted).toBe(false);
    });

    it('closing the menu cancels the reading, nothing said', () => {
        const load = startMenuLoad(h(menu), h(items[0]));
        load.cancel();
        expect(load.signal.aborted).toBe(true);
        expect(load.stopped()).toBe('cancel');
        expect(menu.querySelector('.menu-load-msg')).toBeNull();
        expect(items[1].hasAttribute('aria-disabled')).toBe(false);
    });

    it('past 30 s the reading stops, the sentence under the item, the item usable again', () => {
        const load = startMenuLoad(h(menu), h(items[0]));
        expect(MENU_LOAD_LIMIT_MS).toBe(30_000);
        vi.advanceTimersByTime(29_999);
        expect(load.signal.aborted).toBe(false);
        vi.advanceTimersByTime(1);
        expect(load.signal.aborted).toBe(true);
        expect(load.stopped()).toBe('limit');
        const msg = menu.querySelector('.menu-load-msg')!;
        expect(msg.textContent).toBe(strings.busy.errTimeout(30));
        expect(msg.getAttribute('role')).toBe('alert');
        expect(items[0].nextSibling).toBe(msg);
        expect(items[0].hasAttribute('aria-busy')).toBe(false);
        // A new try takes the sentence away.
        startMenuLoad(h(menu), h(items[0]));
        expect(menu.querySelector('.menu-load-msg')).toBeNull();
    });

    it('a refusal says its sentence under the item; the signal stays as it was', () => {
        const load = startMenuLoad(h(menu), h(items[0]));
        load.fail('The research is not running.');
        expect(menu.querySelector('.menu-load-msg')!.textContent).toBe('The research is not running.');
        expect(load.signal.aborted).toBe(false);
        expect(items[1].hasAttribute('aria-disabled')).toBe(false);
    });
});
