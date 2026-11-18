/**
 * A menu item that reads data before its dialog or action (waiting buttons §4, 4c): the menu stays open, the
 * item says it works (`aria-busy`, the 12 px spinner at its end past 120 ms, its words and marks kept), the
 * other items wait (`aria-disabled`); closing the menu (Escape, a press outside) cancels the reading; past its
 * limit (30 s) the reading stops and a sentence under the item says so, the item usable again. Its end closes
 * the menu and the caller goes on (its dialog, its action).
 */

import { BUSY_SHOW_MS, BUSY_TIMEOUTS, announceBusy, spinEl } from './busy.js';
import { strings } from '../strings.js';

/** A menu item's reading under way. */
export interface MenuLoad {
    /** Aborted when the menu closes or the limit passes. */
    readonly signal: AbortSignal;
    /** Why it stopped: 'cancel' (the menu closed), 'limit' (its time passed); null while it reads. */
    stopped(): 'cancel' | 'limit' | null;
    /** The menu closed (Escape, a press outside): the reading stops, nothing said. */
    cancel(): void;
    /** It read: the item and the others back at rest (the caller closes the menu). */
    done(): void;
    /** It did not read: the sentence under the item (`role=alert`), the item usable again. */
    fail(text: string): void;
}

/** The menu's own limit for a reading before its dialog (§10.1). */
export const MENU_LOAD_LIMIT_MS = BUSY_TIMEOUTS.write;

const OFF_MARK = 'menuLoadOff';
const ITEMS = '[role="menuitem"], [role="menuitemradio"], [role="menuitemcheckbox"]';

/** Starts the reading state of `item` in `menu`. */
export function startMenuLoad(menu: HTMLElement, item: HTMLElement, opts: { limitMs?: number; label?: string } = {}): MenuLoad {
    const ctl = new AbortController();
    let why: 'cancel' | 'limit' | null = null;
    let ended = false;
    const limitMs = opts.limitMs ?? MENU_LOAD_LIMIT_MS;
    menu.querySelector('.menu-load-msg')?.remove();
    menu.setAttribute('aria-busy', 'true');
    item.setAttribute('aria-busy', 'true');
    item.dataset.busy = 'lock';
    for (const other of menu.querySelectorAll<HTMLElement>(ITEMS)) {
        if (other === item || other.getAttribute('aria-disabled') === 'true') continue;
        other.setAttribute('aria-disabled', 'true');
        other.dataset[OFF_MARK] = '1';
    }
    let slot: HTMLElement | null = null;
    const show = setTimeout(() => {
        if (ended) return;
        slot = document.createElement('span');
        slot.className = 'busy-slot menu-load-spin';
        slot.setAttribute('aria-hidden', 'true');
        slot.appendChild(spinEl(12));
        item.appendChild(slot);
        item.dataset.busy = 'busy';
        announceBusy(opts.label ?? strings.busy.generic);
    }, BUSY_SHOW_MS);
    const limit = Number.isFinite(limitMs) ? setTimeout(() => {
        if (ended) return;
        why = 'limit';
        rest();
        say(strings.busy.errTimeout(Math.round(limitMs / 1000)));
        ctl.abort('limit');
    }, limitMs) : null;

    function rest(): void {
        ended = true;
        clearTimeout(show);
        if (limit) clearTimeout(limit);
        slot?.remove();
        item.removeAttribute('aria-busy');
        delete item.dataset.busy;
        menu.removeAttribute('aria-busy');
        for (const other of menu.querySelectorAll<HTMLElement>(ITEMS)) {
            if (other.dataset[OFF_MARK] !== '1') continue;
            other.removeAttribute('aria-disabled');
            delete other.dataset[OFF_MARK];
        }
    }
    function say(text: string): void {
        const msg = document.createElement('div');
        msg.className = 'busy-msg is-err menu-load-msg';
        msg.setAttribute('role', 'alert');
        msg.textContent = text;
        item.after(msg);
    }

    return {
        signal: ctl.signal,
        stopped: () => why,
        cancel() {
            if (ended) return;
            why = 'cancel';
            rest();
            ctl.abort('cancel');
        },
        done() {
            if (!ended) rest();
        },
        fail(text: string) {
            if (ended) return;
            rest();
            say(text);
        },
    };
}
